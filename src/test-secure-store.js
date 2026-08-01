import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-secure-store-'))
process.env.OPENVZ_USER_DIR = temp
process.env.OPENVZ_RESOURCES_DIR = path.resolve('.')

const store = await import('./secure-store.js')
const encoded = store.encryptSecret('correct horse battery staple')
assert.match(encoded, /^v2:/)
assert.equal(store.decryptSecret(encoded), 'correct horse battery staple')

const config = { provider: { apiKey: 'plain-key', nested: { botToken: 'plain-token' } }, harmless: 'visible' }
store.encryptSecretsDeep(config)
assert.doesNotMatch(JSON.stringify(config), /plain-key|plain-token/)
store.decryptSecretsDeep(config)
assert.equal(config.provider.apiKey, 'plain-key')
assert.equal(config.provider.nested.botToken, 'plain-token')
assert.deepEqual(store.redactSecretsDeep(config).provider.apiKey, { configured: true })

const keyFile = path.join(temp, 'data', '.openvz-secret.key')
assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600)
fs.rmSync(temp, { recursive: true, force: true })
console.log('Node AES-256-GCM credential store and 0600 key permissions: OK')
