import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-v21439-upgrade-'))
const dbFile = path.join(temp, 'data', 'jarvis.db')
const legacyKey = 'sk-v21439-upgrade-fixture-1234567890'
fs.mkdirSync(path.dirname(dbFile), { recursive: true })
fs.mkdirSync(path.join(temp, 'workflows'), { recursive: true })

const legacy = new Database(dbFile)
legacy.exec(`
  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    content TEXT NOT NULL,
    detail TEXT NOT NULL,
    entities TEXT DEFAULT '[]',
    concepts TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    source_ref TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE action_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, tool TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
`)
legacy.prepare('INSERT INTO conversations(role, from_id, to_id, content, timestamp) VALUES (?, ?, ?, ?, ?)')
  .run('user', 'ID:000001', null, '2.1.439 conversation survives', '2026-07-03T00:00:00.000Z')
legacy.prepare('INSERT INTO memories(event_type, content, detail, timestamp) VALUES (?, ?, ?, ?)')
  .run('knowledge', '2.1.439 memory survives', 'fixture detail', '2026-07-03T00:00:01.000Z')
legacy.prepare('INSERT INTO config(key, value) VALUES (?, ?)').run('fixture-setting', 'retained')
legacy.close()

fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({
  version: '2.1.439',
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: legacyKey,
  temperature: 0.6,
}, null, 2), { mode: 0o600 })
fs.writeFileSync(path.join(temp, 'workflows', 'legacy.json'), '{"name":"legacy"}')
fs.writeFileSync(path.join(temp, 'mcp.servers.json'), '{"mcpServers":{}}', { mode: 0o600 })

process.env.OPENVZ_USER_DIR = temp
process.env.OPENVZ_RESOURCES_DIR = path.resolve('.')

try {
  // The normal startup path loads config first. That must prepare the rollback
  // snapshot before rewriting legacy plaintext credentials.
  const configModule = await import('./config.js')
  assert.equal(configModule.config.apiKey, legacyKey)
  assert.equal(configModule.config.temperature, 0.6)

  const { getDB, closeDBForTest } = await import('./db/connection.js')
  const db = getDB()
  assert.equal(db.prepare('SELECT content FROM conversations WHERE id = 1').get().content, '2.1.439 conversation survives')
  assert.equal(db.prepare('SELECT content FROM memories WHERE id = 1').get().content, '2.1.439 memory survives')
  assert.equal(db.prepare("SELECT value FROM config WHERE key = 'fixture-setting'").get().value, 'retained')
  assert.ok(db.prepare("PRAGMA table_info(conversations)").all().some(column => column.name === 'thread_id'))
  assert.ok(db.prepare("PRAGMA table_info(memories)").all().some(column => column.name === 'embedding_model'))
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_ui_events'").get())
  closeDBForTest()

  const migrationState = JSON.parse(fs.readFileSync(path.join(temp, 'data', 'migration-state.json'), 'utf8'))
  assert.equal(migrationState.status, 'complete')
  assert.ok(fs.existsSync(path.join(migrationState.backupDir, 'data', 'jarvis.db')))
  assert.ok(fs.existsSync(path.join(migrationState.backupDir, 'workflows', 'legacy.json')))
  assert.match(fs.readFileSync(path.join(migrationState.backupDir, 'config.json'), 'utf8'), new RegExp(legacyKey))
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(migrationState.backupDir).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.join(migrationState.backupDir, 'config.json')).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.join(migrationState.backupDir, 'data', 'jarvis.db')).mode & 0o777, 0o600)
  }

  const storedMain = fs.readFileSync(path.join(temp, 'config.json'), 'utf8')
  const storedProvider = fs.readFileSync(path.join(temp, 'llm', 'deepseek.json'), 'utf8')
  assert.doesNotMatch(storedMain, new RegExp(legacyKey))
  assert.doesNotMatch(storedProvider, new RegExp(legacyKey))
  assert.match(storedProvider, /v2:/)

  console.log('Realistic v2.1.439 DB/config fixture upgrades in place with data and encrypted credentials intact: OK')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
