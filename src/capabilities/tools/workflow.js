// 工作流引擎工具的执行器（App 内）。把 src/workflow/engine.js 的核心逻辑接到 Agent 工具循环。
//
// LLM 适配器基于 App 当前激活的 provider（config.apiKey/baseURL/model）现建一个 OpenAI 兼容客户端，
// 只做简单 completion（引擎内部自己编排 plan/execute/score），并把 turn 的 abort signal 透传下去，
// 这样主循环 watchdog 中断时工作流也能干净地停下。

import OpenAI from 'openai'
import path from 'node:path'
import { config } from '../../config.js'
import { paths } from '../../paths.js'
import { emitEvent } from '../../events.js'
import { recordUsage, shouldThrottle } from '../../quota.js'
import { runGoalWorkflow, planWorkflow, replayWorkflow } from '../../workflow/engine.js'
import { saveWorkflow, listWorkflows, loadWorkflow } from '../../workflow/store.js'
import { sceneStore } from '../../scene/scene-store.js'

const WF_DIR = path.join(paths.userDir, 'workflows')

function makeLlm(signal) {
  if (!config.apiKey) throw new Error('LLM 尚未激活，请先在设置里填入 API Key')
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
  return async (messages) => {
    // 与主循环共用配额/限流：超限时中止工作流，避免绕过 quota.js 悄悄烧 token。
    if (shouldThrottle()) throw new Error('已触发速率/额度限流，工作流暂停（避免超额）。稍后再试。')
    const resp = await client.chat.completions.create(
      { model: config.model, messages, temperature: 0.4 },
      signal ? { signal } : {},
    )
    // 把本次用量计入配额窗口（供限流与自适应节奏使用）。
    recordUsage(resp.usage?.total_tokens || 0)
    return resp.choices?.[0]?.message?.content || ''
  }
}

const WORKFLOW_SURFACE_ID = 'openvz-workflow-active'
let projected = { goal: '', steps: [], overallScore: null, status: 'active' }

function projectWorkflow(payload = {}) {
  if (payload.type === 'plan_start') projected = { goal: payload.goal || projected.goal, steps: [], overallScore: null, status: 'active' }
  if (payload.type === 'plan_done' || payload.phase === 'planned') {
    projected.goal = payload.goal || projected.goal
    projected.steps = (payload.steps || []).map((step) => ({ id: step.id, title: step.title, state: 'pending', score: null }))
  }
  if (payload.type === 'step_exec' || payload.type === 'replay_step') {
    const step = payload.step || {}
    const found = projected.steps.find((item) => item.id === step.id)
    if (found) found.state = 'running'
    else projected.steps.push({ id: step.id, title: step.title, state: 'running', score: null })
  }
  if (payload.type === 'step_scored') {
    const found = projected.steps.find((item) => item.id === payload.step?.id)
    if (found) {
      found.score = Number(payload.verdict?.score || 0)
      found.state = found.score >= 75 ? 'pass' : 'retry'
    }
  }
  if (payload.type === 'done' || payload.type === 'replay_done') {
    projected.overallScore = payload.overallScore
    projected.status = 'done'
  }
  const completed = projected.steps.filter((step) => step.state === 'pass' || step.state === 'retry').length
  sceneStore.set(WORKFLOW_SURFACE_ID, {
    kind: 'progress',
    intent: projected.status === 'done' ? 'ambient' : 'inform',
    data: {
      label: projected.goal || '工作流',
      value: projected.status === 'done' ? projected.steps.length : completed,
      max: Math.max(1, projected.steps.length),
      status: projected.status,
      indeterminate: projected.steps.length === 0 && projected.status !== 'done',
      note: projected.status === 'done' ? `总分 ${projected.overallScore ?? '—'}/100` : `${completed}/${projected.steps.length || '—'} 步`,
      workflow: structuredClone(projected),
    },
  })
}

// SSE event remains for extensions, while SceneStore is the canonical UI state.
const emit = (payload) => {
  try { projectWorkflow(payload) } catch {}
  try { emitEvent('workflow_progress', payload) } catch {}
}

export async function execPlanWorkflow(args = {}, context = {}) {
  const goal = String(args.goal || '').trim()
  if (!goal) return '错误：缺少 goal'
  try {
    const steps = await planWorkflow(makeLlm(context.signal), goal, { maxSteps: 6 })
    if (!steps.length) return '规划失败：模型未返回可用步骤（检查 API Key / 模型是否可用）。'
    emit({ type: 'plan_done', phase: 'planned', goal, steps })
    return `已把目标拆成 ${steps.length} 步：\n` + steps.map(s => `${s.id}. ${s.title} — ${s.instruction}`).join('\n')
  } catch (e) { return `执行失败：${e.message}` }
}

export async function execRunWorkflow(args = {}, context = {}) {
  const goal = String(args.goal || '').trim()
  if (!goal) return '错误：缺少 goal'
  const threshold = Number.isFinite(args.threshold) ? args.threshold : 75
  const maxSteps = Math.max(2, Math.min(Number(args.max_steps) || 5, 6))
  try {
    const llm = makeLlm(context.signal)
    const wf = await runGoalWorkflow(llm, goal, {
      threshold,
      maxRetriesPerStep: 1,
      maxSteps,
      onEvent: (e) => emit({ phase: 'run', goal, ...e }),
    })
    const { file } = saveWorkflow(WF_DIR, args.name || goal.slice(0, 40), wf)
    const lines = wf.steps.map(s => `  ${s.id}. ${s.title} — ${s.score}/100 ${s.pass ? '✅' : '↻'}${s.attempts > 1 ? `（重试 ${s.attempts - 1} 次）` : ''}`)
    return `工作流完成，总分 ${wf.overallScore}/100：\n${lines.join('\n')}\n\n已存为可复用工作流「${path.basename(file, '.json')}」，之后可用 replay_workflow 一键复用。`
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    return `执行失败：${e.message}`
  }
}

export function execListWorkflows() {
  const list = listWorkflows(WF_DIR)
  if (!list.length) return '还没有已保存的工作流。给我一个目标并让我 run_workflow，就会自动生成并保存一个。'
  return '已保存的可复用工作流：\n' + list.map(w => `  - ${w.name}（${w.steps} 步，上次总分 ${w.overallScore ?? '—'}/100）`).join('\n')
}

export async function execReplayWorkflow(args = {}, context = {}) {
  const name = String(args.name || '').trim()
  if (!name) return '错误：缺少 name'
  const wf = loadWorkflow(WF_DIR, name)
  if (!wf) return `未找到工作流「${name}」。可用 list_workflows 查看已有的。`
  try {
    emit({ type: 'plan_done', phase: 'replay', goal: wf.goal, steps: wf.steps || [] })
    const r = await replayWorkflow(makeLlm(context.signal), wf, {
      rescore: true,
      onEvent: (e) => emit({ phase: 'replay', goal: wf.goal, ...e }),
    })
    return `已复用工作流「${wf.name}」，重跑 ${r.steps.length} 步，总分 ${r.overallScore ?? '—'}/100。`
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    return `执行失败：${e.message}`
  }
}
