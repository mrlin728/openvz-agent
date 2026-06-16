import { execManageToolFactory } from './capabilities/tool-factory.js'
import { executeInstalledTool, getInstalledToolSchema, uninstallTool } from './capabilities/marketplace/index.js'

const checks = []

function assert(condition, label, detail = '') {
  checks.push({ ok: !!condition, label, detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}${condition ? '' : (detail ? `\n  ${detail}` : '')}`)
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return null
  }
}

const suffix = Date.now().toString(36)
const goodName = `factory_echo_${suffix}`
const badName = `factory_bad_${suffix}`

// ── rejected proposal: dangerous global access ───────────────────────────────
{
  const proposed = parseJson(await execManageToolFactory({
    action: 'propose',
    name: badName,
    description: 'Bad test tool that should fail review.',
    parameters_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    code: 'return String(process.cwd())',
    tests: [{ name: 'runs', args: {}, expect_contains: '' }],
  }))
  assert(proposed?.ok === true && proposed.proposal_id, 'bad proposal can be stored as draft', JSON.stringify(proposed))

  const reviewed = parseJson(await execManageToolFactory({
    action: 'review',
    proposal_id: proposed.proposal_id,
  }))
  assert(reviewed?.ok === false && reviewed.status === 'rejected', 'review rejects dangerous proposal', JSON.stringify(reviewed))
  assert((reviewed?.issues || []).some(i => /global runtime access|process/.test(i)), 'review explains dangerous global access', JSON.stringify(reviewed?.issues))

  const installAttempt = parseJson(await execManageToolFactory({
    action: 'install',
    proposal_id: proposed.proposal_id,
  }))
  assert(installAttempt?.ok === false, 'rejected proposal cannot be installed', JSON.stringify(installAttempt))

  await execManageToolFactory({ action: 'delete', proposal_id: proposed.proposal_id })
}

// ── approved proposal: review -> install -> callable ─────────────────────────
{
  const proposed = parseJson(await execManageToolFactory({
    action: 'propose',
    name: goodName,
    description: 'Return the input text in uppercase for factory smoke tests.',
    parameters_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to uppercase.' },
      },
      required: ['text'],
    },
    permissions: { network: false, exec: false },
    code: 'const text = String(args.text || ""); return text.toUpperCase();',
    tests: [
      { name: 'uppercase ascii', args: { text: 'hello' }, expect: 'HELLO' },
      { name: 'empty string', args: { text: '' }, expect: '' },
    ],
  }))
  assert(proposed?.ok === true && proposed.proposal_id, 'good proposal stored as draft', JSON.stringify(proposed))

  const earlyInstall = parseJson(await execManageToolFactory({
    action: 'install',
    proposal_id: proposed.proposal_id,
  }))
  assert(earlyInstall?.ok === false, 'draft proposal cannot skip review', JSON.stringify(earlyInstall))

  const reviewed = parseJson(await execManageToolFactory({
    action: 'review',
    proposal_id: proposed.proposal_id,
  }))
  assert(reviewed?.ok === true && reviewed.status === 'approved', 'good proposal approved by review gate', JSON.stringify(reviewed))
  assert((reviewed?.test_results || []).length === 2 && reviewed.test_results.every(t => t.ok), 'all proposal tests pass', JSON.stringify(reviewed?.test_results))

  const installed = parseJson(await execManageToolFactory({
    action: 'install',
    proposal_id: proposed.proposal_id,
  }))
  assert(installed?.ok === true && installed.tool === goodName, 'approved proposal installs tool', JSON.stringify(installed))

  const schema = getInstalledToolSchema(goodName)
  assert(schema?.function?.name === goodName, 'installed tool exposes function-call schema', JSON.stringify(schema))

  const result = await executeInstalledTool(goodName, { text: 'bailongma' })
  assert(result === 'BAILONGMA', 'installed generated tool executes through marketplace registry', result)

  uninstallTool({ name: goodName })
  await execManageToolFactory({ action: 'delete', proposal_id: proposed.proposal_id })
}

const failed = checks.filter(c => !c.ok)
console.log(`\nTool factory checks: ${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) process.exitCode = 1
