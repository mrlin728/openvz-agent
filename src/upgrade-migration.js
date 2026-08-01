import fs from 'node:fs'
import path from 'node:path'

export const TARGET_DATA_VERSION = '2.2.0'

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return fallback }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  try { fs.chmodSync(path.dirname(file), 0o700) } catch {}
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try { fs.chmodSync(tmp, 0o600) } catch {}
  fs.renameSync(tmp, file)
}

function safeStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  const stat = fs.statSync(source)
  if (stat.isDirectory()) fs.cpSync(source, destination, { recursive: true, errorOnExist: false })
  else fs.copyFileSync(source, destination)
  return true
}

function hardenBackupTree(target) {
  if (!fs.existsSync(target)) return
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) return
  try { fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600) } catch {}
  if (!stat.isDirectory()) return
  for (const entry of fs.readdirSync(target)) hardenBackupTree(path.join(target, entry))
}

function migrationPaths(userDir) {
  const dataDir = path.join(userDir, 'data')
  return {
    stateFile: path.join(dataDir, 'migration-state.json'),
    backupRoot: path.join(userDir, 'backups', `v${TARGET_DATA_VERSION}`),
  }
}

export function prepareUpgradeBackup({ userDir, configFile, dbFile, now = new Date() }) {
  const { stateFile, backupRoot } = migrationPaths(userDir)
  const current = readJson(stateFile, {})
  if (current?.targetVersion === TARGET_DATA_VERSION && current?.status === 'complete') {
    return { needed: false, ...current }
  }
  if (current?.targetVersion === TARGET_DATA_VERSION && current?.status === 'prepared' && current?.backupDir) {
    return { needed: true, ...current }
  }

  const backupDir = path.join(backupRoot, safeStamp(now))
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const candidates = [
    [configFile, 'config.json'],
    [dbFile, path.join('data', 'jarvis.db')],
    [`${dbFile}-wal`, path.join('data', 'jarvis.db-wal')],
    [`${dbFile}-shm`, path.join('data', 'jarvis.db-shm')],
    [path.join(userDir, 'mcp.servers.json'), 'mcp.servers.json'],
    [path.join(userDir, 'api-capability-slots.json'), 'api-capability-slots.json'],
    [path.join(userDir, 'workflows'), 'workflows'],
    [path.join(userDir, 'llm'), 'llm'],
    [path.join(userDir, 'voice'), 'voice'],
  ]
  const files = []
  for (const [source, relative] of candidates) {
    if (copyIfPresent(source, path.join(backupDir, relative))) files.push({ source, relative })
  }
  // Legacy config backups can still contain plaintext credentials. Keep the
  // rollback copy private even when its source file had permissive old modes.
  hardenBackupTree(backupDir)
  const state = {
    targetVersion: TARGET_DATA_VERSION,
    status: 'prepared',
    preparedAt: now.toISOString(),
    backupDir,
    files,
  }
  writeJson(stateFile, state)
  return { needed: true, ...state }
}

export function completeUpgradeMigration({ userDir }) {
  const { stateFile } = migrationPaths(userDir)
  const state = readJson(stateFile, {})
  writeJson(stateFile, {
    ...state,
    targetVersion: TARGET_DATA_VERSION,
    status: 'complete',
    completedAt: new Date().toISOString(),
  })
}

export function restoreUpgradeBackup({ userDir }) {
  const { stateFile } = migrationPaths(userDir)
  const state = readJson(stateFile, null)
  if (!state?.backupDir || !Array.isArray(state.files)) return false
  for (const entry of state.files) {
    copyIfPresent(path.join(state.backupDir, entry.relative), entry.source)
  }
  writeJson(stateFile, {
    ...state,
    status: 'restored',
    restoredAt: new Date().toISOString(),
  })
  return true
}

export const __internal = { migrationPaths, safeStamp }
