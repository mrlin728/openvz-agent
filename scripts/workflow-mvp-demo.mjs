#!/usr/bin/env node
// 自进化工作流引擎 —— 可本机运行的 MVP 演示。
//
// 用法（二选一）：
//   1) 用环境变量指定 Key：
//        LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-chat \
//        node scripts/workflow-mvp-demo.mjs "帮我写一篇介绍 OpenVZ Agent 的短文"
//   2) 直接复用 App 里已配置的 Key（未加密时自动读取）：
//        node scripts/workflow-mvp-demo.mjs "帮我调研 3 个竞品并给出对比"
//
// 它会：拆分任务 → 逐步执行 → 每步独立评分 → 不达标按建议重试一次 → 存成可复用工作流(JSON)。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import OpenAI from 'openai'
import { runGoalWorkflow } from '../src/workflow/engine.js'
import { saveWorkflow } from '../src/workflow/store.js'

const APP_CFG = path.join(os.homedir(), 'Library', 'Application Support', 'OpenVZ Agent')
const DEFAULT_BASE = { deepseek: 'https://api.deepseek.com', openai: 'https://api.openai.com/v1', minimax: 'https://api.minimax.chat/v1', moonshot: 'https://api.moonshot.cn/v1', zhipu: 'https://open.bigmodel.cn/api/paas/v4' }
const DEFAULT_MODEL = { deepseek: 'deepseek-chat', openai: 'gpt-4o-mini', minimax: 'MiniMax-M2.7', moonshot: 'moonshot-v1-8k', zhipu: 'glm-4-flash' }

function resolveLlmConfig() {
  if (process.env.LLM_API_KEY) {
    return {
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL || DEFAULT_BASE.deepseek,
      model: process.env.LLM_MODEL || DEFAULT_MODEL.deepseek,
      source: 'env',
    }
  }
  const dir = path.join(APP_CFG, 'llm')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        const provider = f.replace(/\.json$/, '')
        const key = j.apiKey
        if (typeof key === 'string' && key && !key.startsWith('v1:')) {
          return { apiKey: key, baseURL: j.baseURL || DEFAULT_BASE[provider] || DEFAULT_BASE.deepseek, model: j.model || DEFAULT_MODEL[provider] || DEFAULT_MODEL.deepseek, source: `app config (${provider})` }
        }
      } catch {}
    }
  }
  return null
}

async function main() {
  const goal = process.argv.slice(2).join(' ').trim()
  if (!goal) { console.error('用法: node scripts/workflow-mvp-demo.mjs "<你的目标>"'); process.exit(2) }

  const cfg = resolveLlmConfig()
  if (!cfg) {
    console.error('未找到可用的 API Key。请用环境变量：LLM_API_KEY=... [LLM_BASE_URL=...] [LLM_MODEL=...]')
    console.error('（App 里的 Key 若已加密存储，无法在此读取，请改用环境变量。）')
    process.exit(2)
  }
  console.log(`\n▶ LLM: ${cfg.model}  (${cfg.source})`)
  console.log(`▶ 目标: ${goal}\n`)

  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  // 注入的 llm：把引擎的 (messages, opts) 适配到 OpenAI 兼容接口。
  const llm = async (messages, _opts = {}) => {
    const resp = await client.chat.completions.create({ model: cfg.model, messages, temperature: 0.4 })
    return resp.choices?.[0]?.message?.content || ''
  }

  const bar = (n) => '█'.repeat(Math.round(n / 5)).padEnd(20, '·')
  const wf = await runGoalWorkflow(llm, goal, {
    threshold: 75,
    maxRetriesPerStep: 1,
    onEvent: (e) => {
      if (e.type === 'plan_done') { console.log('📋 拆分为', e.steps.length, '步：'); e.steps.forEach(s => console.log(`   ${s.id}. ${s.title}`)); console.log('') }
      if (e.type === 'step_exec') console.log(`⚙️  执行 步骤${e.step.id}「${e.step.title}」(第 ${e.attempt} 次)…`)
      if (e.type === 'step_scored') console.log(`   评分 ${bar(e.verdict.score)} ${e.verdict.score}/100  ${e.verdict.score >= 75 ? '✅达标' : '↻ ' + (e.verdict.fix_hint || '需改进')}`)
      if (e.type === 'done') console.log(`\n🏁 总分 ${e.overallScore}/100`)
    },
  })

  const outDir = path.join(process.cwd(), 'workflows')
  const { file } = saveWorkflow(outDir, goal.slice(0, 40), wf)
  console.log(`\n💾 已存为可复用工作流: ${file}`)
  console.log('   （之后可用 replayWorkflow / 未来的 run_workflow 工具一键复用同一套流程）')
}

main().catch((e) => { console.error('\n❌ 运行失败:', e?.message || e); process.exit(1) })
