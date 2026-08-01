import fs from 'fs'
import path from 'path'
import { paths } from '../paths.js'
import {
  decryptSecretRecord,
  encryptSecretRecord,
  FALLBACK_SCHEME,
  PLAIN_SCHEME,
  SAFE_STORAGE_SCHEME,
} from '../secure-store.js'

const STORE_VERSION = 1

function nowIso() {
  return new Date().toISOString()
}

function readJsonFile(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeJsonFile(file, value) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try { fs.chmodSync(tmp, 0o600) } catch {}
  fs.renameSync(tmp, file)
}

function readStore() {
  const parsed = readJsonFile(paths.apiCapabilitySecretsFile, null)
  if (parsed && parsed.version === STORE_VERSION && parsed.secrets && typeof parsed.secrets === 'object') {
    return migratePlainSecrets(parsed)
  }
  return { version: STORE_VERSION, secrets: {} }
}

function migratePlainSecrets(store) {
  let changed = false
  const secrets = store?.secrets && typeof store.secrets === 'object' ? store.secrets : {}
  for (const [key, record] of Object.entries(secrets)) {
    if (!record || record.scheme !== PLAIN_SCHEME) continue
    const value = String(record.value || '')
    if (!value) continue
    secrets[key] = {
      ...encryptSecretRecord(value),
      updatedAt: nowIso(),
    }
    changed = true
  }
  if (changed) writeStore(store)
  return store
}

function writeStore(store) {
  writeJsonFile(paths.apiCapabilitySecretsFile, {
    version: STORE_VERSION,
    secrets: store?.secrets && typeof store.secrets === 'object' ? store.secrets : {},
  })
}

export function setSecret(ref, value) {
  const key = String(ref || '').trim()
  const secret = String(value || '')
  if (!key) throw new Error('secret ref required')
  if (!secret) {
    deleteSecret(key)
    return false
  }
  const store = readStore()
  store.secrets[key] = {
    ...encryptSecretRecord(secret),
    updatedAt: nowIso(),
  }
  writeStore(store)
  return true
}

export function getSecret(ref) {
  const key = String(ref || '').trim()
  if (!key) return ''
  return decryptSecretRecord(readStore().secrets[key]) || ''
}

export function hasSecret(ref) {
  return !!getSecret(ref)
}

export function deleteSecret(ref) {
  const key = String(ref || '').trim()
  if (!key) return false
  const store = readStore()
  if (!Object.prototype.hasOwnProperty.call(store.secrets, key)) return false
  delete store.secrets[key]
  writeStore(store)
  return true
}

export const __internal = {
  FALLBACK_SCHEME,
  PLAIN_SCHEME,
  SAFE_STORAGE_SCHEME,
  decryptSecret: decryptSecretRecord,
  encryptSecret: encryptSecretRecord,
}
