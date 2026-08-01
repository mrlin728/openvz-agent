import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-api-redaction-'))
process.env.OPENVZ_USER_DIR = temp
process.env.OPENVZ_RESOURCES_DIR = path.resolve('.')

const secret = 'sk-openvz-redaction-fixture-1234567890'

try {
  const configModule = await import('./config.js')
  configModule.commitPreparedActivation({
    provider: 'deepseek',
    apiKey: secret,
    model: 'deepseek-chat',
  })

  const summaries = configModule.getProviderSummaries()
  assert.equal(summaries.deepseek.configured, true)
  assert.equal(summaries.deepseek.apiKey, '')
  assert.doesNotMatch(JSON.stringify(summaries), new RegExp(secret))

  const { handleSettingsRoutes } = await import('./api/routes/settings.js')
  let statusCode = 0
  let responseBody = ''
  const response = {
    writeHead(status) { statusCode = status },
    end(body) { responseBody = String(body || '') },
  }
  const handled = await handleSettingsRoutes(
    { method: 'GET' },
    response,
    new URL('http://127.0.0.1/settings'),
  )
  assert.equal(handled, true)
  assert.equal(statusCode, 200)
  assert.doesNotMatch(responseBody, new RegExp(secret))
  const settings = JSON.parse(responseBody)
  assert.equal(settings.llm.apiKey, '')
  assert.equal(settings.providers.deepseek.apiKey, '')

  const { buildToolAuditRecord, sanitizeToolAuditArgs } = await import('./capabilities/tool-audit.js')
  const auditArgs = sanitizeToolAuditArgs('manage_api_capability', {
    api_key: secret,
    endpoint: `https://example.test/run?access_token=${secret}`,
  })
  assert.equal(auditArgs.api_key, '[redacted]')
  assert.doesNotMatch(JSON.stringify(auditArgs), new RegExp(secret))

  const record = buildToolAuditRecord({
    name: 'mcp__fixture__echo',
    args: { authorization: `Bearer ${secret}` },
    context: { source: 'test' },
    policy: { risk: 'medium' },
    status: 'error',
    result: JSON.stringify({ apiKey: secret, output: `Bearer ${secret}` }),
    error: `request failed with token=${secret}`,
    startedAt: Date.now(),
  })
  assert.doesNotMatch(JSON.stringify(record), new RegExp(secret))
  assert.match(JSON.stringify(record), /\[redacted\]/)

  console.log('Settings API, tool events and audit records do not expose stored credentials: OK')
} finally {
  try {
    const { closeDBForTest } = await import('./db.js')
    closeDBForTest()
  } catch {}
  try {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (error) {
    // Windows runners can keep a just-closed native file handle alive until
    // process exit. The fixture contains fake credentials and the isolated
    // runner temp directory is reclaimed after the process/job exits.
    if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error?.code)) throw error
  }
}
