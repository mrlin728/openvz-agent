import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { completeUpgradeMigration, prepareUpgradeBackup, restoreUpgradeBackup } from './upgrade-migration.js'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-upgrade-'))
const configFile = path.join(temp, 'config.json')
const dbFile = path.join(temp, 'data', 'jarvis.db')
fs.mkdirSync(path.dirname(dbFile), { recursive: true })
fs.mkdirSync(path.join(temp, 'workflows'), { recursive: true })
fs.writeFileSync(configFile, JSON.stringify({ version: '2.1.439', apiKey: 'legacy-fixture-key' }))
fs.writeFileSync(dbFile, 'v2.1.439-sqlite-fixture')
fs.writeFileSync(path.join(temp, 'workflows', 'fixture.json'), '{"goal":"keep me"}')
fs.writeFileSync(path.join(temp, 'mcp.servers.json'), '{"mcpServers":{"fixture":{"disabled":true}}}')

const prepared = prepareUpgradeBackup({ userDir: temp, configFile, dbFile, now: new Date('2026-08-01T00:00:00.000Z') })
assert.equal(prepared.status, 'prepared')
assert.ok(fs.existsSync(path.join(prepared.backupDir, 'config.json')))
assert.ok(fs.existsSync(path.join(prepared.backupDir, 'data', 'jarvis.db')))
assert.ok(fs.existsSync(path.join(prepared.backupDir, 'workflows', 'fixture.json')))
assert.ok(fs.existsSync(path.join(prepared.backupDir, 'mcp.servers.json')))
if (process.platform !== 'win32') {
  assert.equal(fs.statSync(prepared.backupDir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(path.join(prepared.backupDir, 'config.json')).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.join(prepared.backupDir, 'data', 'jarvis.db')).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.join(prepared.backupDir, 'workflows', 'fixture.json')).mode & 0o777, 0o600)
}

fs.writeFileSync(configFile, 'broken')
fs.writeFileSync(dbFile, 'broken')
assert.equal(restoreUpgradeBackup({ userDir: temp }), true)
assert.match(fs.readFileSync(configFile, 'utf-8'), /2\.1\.439/)
assert.equal(fs.readFileSync(dbFile, 'utf-8'), 'v2.1.439-sqlite-fixture')

completeUpgradeMigration({ userDir: temp })
const skipped = prepareUpgradeBackup({ userDir: temp, configFile, dbFile })
assert.equal(skipped.needed, false)
assert.equal(skipped.status, 'complete')

fs.rmSync(temp, { recursive: true, force: true })
console.log('v2.1.439 config/database/workflow/MCP backup and rollback: OK')
