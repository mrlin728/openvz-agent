// Offline unit test for the workflow engine — mock LLM, no network.
// Run: node src/workflow/engine.test.mjs   (exits non-zero on failure)

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseJsonLoose, planWorkflow, runGoalWorkflow, replayWorkflow } from './engine.js'
import { saveWorkflow, loadWorkflow, listWorkflows } from './store.js'

let pass = 0
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓', name); pass++ }

// 1) parseJsonLoose tolerates code fences + surrounding prose
ok('parseJsonLoose strips ```json fence',
  parseJsonLoose('sure!\n```json\n{"a":1}\n```').a === 1)
ok('parseJsonLoose slices braces', parseJsonLoose('junk {"b":2} tail').b === 2)

// Mock LLM: routes by the system prompt so we can script plan/execute/score.
// Scorer returns a LOW score the first time step 1 is scored, HIGH afterwards →
// exercises the "retry once when below threshold" path.
let step1Scores = 0
function makeMock() {
  return async (messages) => {
    const sys = messages.find(m => m.role === 'system')?.content || ''
    const user = messages.find(m => m.role === 'user')?.content || ''
    if (sys.includes('任务规划器')) {
      return '```json\n{"steps":[{"title":"A","instruction":"do a"},{"title":"B","instruction":"do b"}]}\n```'
    }
    if (sys.includes('执行者')) {
      return `RESULT for ${user.includes('步骤：A') ? 'A' : 'B'}`
    }
    if (sys.includes('独立评审')) {
      const isA = user.includes('步骤：A')
      if (isA) { step1Scores++; return JSON.stringify({ score: step1Scores === 1 ? 40 : 90, pass: step1Scores !== 1, issues: ['x'], fix_hint: 'improve a' }) }
      return JSON.stringify({ score: 88, pass: true, issues: [], fix_hint: '' })
    }
    return '{}'
  }
}

// 2) planWorkflow parses + normalizes steps
const planned = await planWorkflow(makeMock(), 'goal')
ok('planWorkflow returns 2 steps', planned.length === 2)
ok('planWorkflow assigns ids + fields', planned[0].id === 1 && planned[0].instruction === 'do a')

// 3) runGoalWorkflow: step A retried once (40→90), step B single pass
const events = []
const wf = await runGoalWorkflow(makeMock(), 'goal', { threshold: 75, maxRetriesPerStep: 1, onEvent: e => events.push(e.type) })
ok('workflow has 2 steps', wf.steps.length === 2)
ok('step A retried (attempts=2)', wf.steps[0].attempts === 2)
ok('step A final score >= threshold', wf.steps[0].score >= 75)
ok('step B single attempt', wf.steps[1].attempts === 1)
ok('overallScore is avg (89)', wf.overallScore === Math.round((wf.steps[0].score + wf.steps[1].score) / 2))
ok('emitted plan+done events', events.includes('plan_done') && events.includes('done'))

// 4) store round-trip
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'))
const { id } = saveWorkflow(dir, '我的 测试 Workflow!', wf)
const loaded = loadWorkflow(dir, '我的 测试 Workflow!')
ok('saveWorkflow slug + load round-trip', loaded && loaded.goal === 'goal' && loaded.steps.length === 2)
ok('listWorkflows returns summary', listWorkflows(dir)[0].id === id)

// 5) replayWorkflow re-runs saved steps
const replay = await replayWorkflow(makeMock(), loaded, { rescore: true })
ok('replay produced results for all steps', replay.steps.length === 2 && replay.steps.every(s => s.result))
fs.rmSync(dir, { recursive: true, force: true })

console.log(`\nALL ${pass} ASSERTIONS PASSED`)
