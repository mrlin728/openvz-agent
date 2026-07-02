// workflow/engine.js — 自进化工作流引擎（MVP 核心）。
//
// 目标 → 拆分任务 → 逐步执行 → 每步评分 → 不达标按 fix_hint 重试 → 汇总为可复用工作流。
//
// 设计要点：LLM 以【依赖注入】方式传入（`llm(messages, opts) => string`），
// 这样同一份核心逻辑既能被独立 demo 脚本使用（自建 OpenAI 客户端 + 你的 Key），
// 也能在 App 内复用主进程的 callLLM。引擎本身不依赖 electron / better-sqlite3，
// 可在纯 Node 下运行与单元测试。

/** 从 LLM 文本里稳健地抽出 JSON（容忍 ```json 代码块、前后多余文字）。*/
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return null
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 退而求其次：截取第一个 { 到最后一个 }
  if (!(s.startsWith('{') || s.startsWith('['))) {
    const a = s.indexOf('{'); const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) s = s.slice(a, b + 1)
  }
  try { return JSON.parse(s) } catch { return null }
}

const clampScore = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** 目标 → 有序步骤列表 [{ title, instruction }]。*/
export async function planWorkflow(llm, goal, { maxSteps = 6 } = {}) {
  const system = '你是一个任务规划器。把用户目标拆成一个有序、可执行、彼此衔接的步骤列表。'
    + `步骤数量控制在 2-${maxSteps} 个。每步要有一个简短标题和一句具体到"可以直接照做"的指令。`
    + '只返回 JSON，格式：{"steps":[{"title":"...","instruction":"..."}]}，不要输出任何其它文字。'
  const out = await llm([
    { role: 'system', content: system },
    { role: 'user', content: `目标：${goal}` },
  ], { json: true })
  const parsed = parseJsonLoose(out)
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : []
  return steps
    .filter(s => s && (s.instruction || s.title))
    .map((s, i) => ({
      id: i + 1,
      title: String(s.title || `步骤 ${i + 1}`).slice(0, 120),
      instruction: String(s.instruction || s.title || '').slice(0, 2000),
    }))
}

/** 执行单个步骤，返回结果文本。context = 之前步骤的结果摘要。*/
export async function executeStep(llm, { goal, step, context = '', fixHint = '' }) {
  const system = '你是一个执行者。只完成"当前步骤"，产出这一步的实际成果（不是计划、不是复述）。'
    + '成果要具体、可直接使用。'
  const parts = [`总目标：${goal}`, `当前步骤：${step.title}`, `步骤指令：${step.instruction}`]
  if (context) parts.push(`已完成步骤的结果（供衔接，勿重复）：\n${context}`)
  if (fixHint) parts.push(`上一次尝试的问题，请针对性改进：${fixHint}`)
  return (await llm([
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ], {})) || ''
}

/** 对一步结果评分。返回 { score(0-100), pass, issues[], fix_hint }。*/
export async function scoreStep(llm, { goal, step, result }) {
  const system = '你是一个独立评审（第二意见），对照目标与步骤要求，客观评估这步成果的质量。'
    + '只返回 JSON：{"score":0-100,"pass":true/false,"issues":["..."],"fix_hint":"一句可操作的改进建议"}。'
    + 'score≥75 视为达标。不要输出 JSON 以外的文字。'
  const out = await llm([
    { role: 'system', content: system },
    { role: 'user', content: `总目标：${goal}\n步骤：${step.title} — ${step.instruction}\n\n成果：\n${result}` },
  ], { json: true })
  const p = parseJsonLoose(out) || {}
  const score = clampScore(p.score)
  return {
    score,
    pass: typeof p.pass === 'boolean' ? p.pass : score >= 75,
    issues: Array.isArray(p.issues) ? p.issues.map(String).slice(0, 8) : [],
    fix_hint: String(p.fix_hint || '').slice(0, 500),
  }
}

/**
 * 跑完整工作流：plan → 逐步 execute → score →（不达标）按 fix_hint 重试 maxRetriesPerStep 次。
 * onEvent(evt) 用于把进度实时抛给调用方（demo 打印 / UI 面板）。
 * 返回可持久化的工作流对象。
 */
export async function runGoalWorkflow(llm, goal, {
  threshold = 75,
  maxRetriesPerStep = 1,
  maxSteps = 6,
  onEvent = () => {},
} = {}) {
  const startedAt = new Date().toISOString()
  onEvent({ type: 'plan_start', goal })
  const planned = await planWorkflow(llm, goal, { maxSteps })
  if (planned.length === 0) throw new Error('规划失败：模型没有返回可用的步骤（检查 API Key / 模型是否可用）')
  onEvent({ type: 'plan_done', steps: planned })

  const steps = []
  let context = ''
  for (const step of planned) {
    let attempts = 0
    let result = ''
    let verdict = null
    let fixHint = ''
    // 首次执行 + 最多 maxRetriesPerStep 次按评分改进
    while (attempts <= maxRetriesPerStep) {
      attempts += 1
      onEvent({ type: 'step_exec', step, attempt: attempts })
      result = await executeStep(llm, { goal, step, context, fixHint })
      verdict = await scoreStep(llm, { goal, step, result })
      onEvent({ type: 'step_scored', step, attempt: attempts, verdict })
      if (verdict.score >= threshold) break
      fixHint = verdict.fix_hint || (verdict.issues[0] || '')
      if (attempts > maxRetriesPerStep) break
    }
    steps.push({
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      result,
      score: verdict.score,
      pass: verdict.score >= threshold,
      attempts,
      issues: verdict.issues,
    })
    context += `【${step.title}】${String(result).slice(0, 600)}\n`
  }

  const overallScore = steps.length
    ? Math.round(steps.reduce((a, s) => a + s.score, 0) / steps.length)
    : 0
  onEvent({ type: 'done', overallScore })

  return {
    schemaVersion: 1,
    goal,
    startedAt,
    finishedAt: new Date().toISOString(),
    threshold,
    overallScore,
    // reusable：只需 title+instruction 即可回放；result/score 作为最近一次运行的元数据
    steps,
  }
}

/**
 * 回放一个已保存的工作流：按保存的步骤指令重新执行（可选重新评分）。
 * 复用性的体现——同一套拆分与指令可在新的一次运行里直接跑。
 */
export async function replayWorkflow(llm, workflow, { rescore = true, threshold = 75, onEvent = () => {} } = {}) {
  const goal = workflow.goal
  const steps = []
  let context = ''
  for (const saved of (workflow.steps || [])) {
    const step = { id: saved.id, title: saved.title, instruction: saved.instruction }
    onEvent({ type: 'replay_step', step })
    const result = await executeStep(llm, { goal, step, context })
    const verdict = rescore ? await scoreStep(llm, { goal, step, result }) : { score: null, issues: [] }
    steps.push({ ...step, result, score: verdict.score, issues: verdict.issues })
    context += `【${step.title}】${String(result).slice(0, 600)}\n`
  }
  const scored = steps.filter(s => typeof s.score === 'number')
  const overallScore = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null
  onEvent({ type: 'replay_done', overallScore })
  return { ...workflow, replayedAt: new Date().toISOString(), overallScore, steps }
}
