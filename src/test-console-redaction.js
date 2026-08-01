import assert from 'node:assert/strict'
import consoleRedaction from './runtime/console-redaction.cjs'
import { sanitizeApiResponse } from './api/utils.js'

const secret = 'sk-console-redaction-fixture-1234567890'
const cleanLog = consoleRedaction.sanitizeConsoleArgument({
  safe: 'visible',
  nested: { apiKey: secret, error: `Authorization: Bearer ${secret}` },
})
assert.equal(cleanLog.safe, 'visible')
assert.equal(cleanLog.nested.apiKey, '[redacted]')
assert.doesNotMatch(JSON.stringify(cleanLog), new RegExp(secret))

const cleanResponse = sanitizeApiResponse({
  apiKey: 'unprefixed-private-value',
  token: 'activation-transaction-id',
  provider: { configured: true },
  error: `request rejected token=${secret}`,
  schema: { api_key: { type: 'string', description: 'credential input' } },
})
assert.equal(cleanResponse.apiKey, '[redacted]')
assert.equal(cleanResponse.token, 'activation-transaction-id')
assert.deepEqual(cleanResponse.provider, { configured: true })
assert.deepEqual(cleanResponse.schema.api_key, { type: 'string', description: 'credential input' })
assert.doesNotMatch(JSON.stringify(cleanResponse), new RegExp(secret))

console.log('Global console and HTTP JSON redaction: OK')
