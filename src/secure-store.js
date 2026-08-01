// Unified OpenVZ credential storage.
// Packaged Electron uses safeStorage (`v1:`); pure Node uses a local
// AES-256-GCM master key with mode 0600 (`v2:`). Plain legacy values are
// accepted on read and are encrypted the next time their containing file is written.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { paths } from './paths.js'

const require = createRequire(import.meta.url)
const SAFE_PREFIX = 'v1:'
const AES_PREFIX = 'v2:'
export const SAFE_STORAGE_SCHEME = 'electron-safe-storage'
export const FALLBACK_SCHEME = 'aes-256-gcm'
export const PLAIN_SCHEME = 'plain'

function getSafeStorage() {
  if (!process.versions?.electron) return null
  try {
    const safeStorage = require('electron')?.safeStorage
    return safeStorage?.isEncryptionAvailable?.() ? safeStorage : null
  } catch {
    return null
  }
}

function fallbackMasterKey() {
  try {
    const key = Buffer.from(fs.readFileSync(paths.secretKeyFile, 'utf-8').trim(), 'base64')
    if (key.length === 32) return key
  } catch {}

  const key = crypto.randomBytes(32)
  fs.mkdirSync(path.dirname(paths.secretKeyFile), { recursive: true })
  fs.writeFileSync(paths.secretKeyFile, key.toString('base64'), { encoding: 'utf-8', mode: 0o600 })
  try { fs.chmodSync(paths.secretKeyFile, 0o600) } catch {}
  return key
}

function fallbackMasterKeysForDecrypt() {
  const keys = [fallbackMasterKey()]
  try {
    const legacy = Buffer.from(fs.readFileSync(paths.apiCapabilitySecretKeyFile, 'utf-8').trim(), 'base64')
    if (legacy.length >= 32 && !legacy.subarray(0, 32).equals(keys[0])) keys.push(legacy.subarray(0, 32))
  } catch {}
  return keys
}

export function isSecureStoreAvailable() {
  return Boolean(getSafeStorage())
}

export function encryptSecretRecord(value) {
  const text = String(value || '')
  const safeStorage = getSafeStorage()
  if (safeStorage) {
    return { scheme: SAFE_STORAGE_SCHEME, value: safeStorage.encryptString(text).toString('base64') }
  }

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(FALLBACK_SCHEME, fallbackMasterKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()])
  return {
    scheme: FALLBACK_SCHEME,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    value: encrypted.toString('base64'),
  }
}

export function decryptSecretRecord(record) {
  if (!record || typeof record !== 'object') return null
  try {
    if (record.scheme === SAFE_STORAGE_SCHEME) {
      const safeStorage = getSafeStorage()
      if (!safeStorage) return null
      return safeStorage.decryptString(Buffer.from(String(record.value || ''), 'base64'))
    }
    if (record.scheme === FALLBACK_SCHEME) {
      for (const key of fallbackMasterKeysForDecrypt()) {
        try {
          const decipher = crypto.createDecipheriv(FALLBACK_SCHEME, key, Buffer.from(String(record.iv || ''), 'base64'))
          decipher.setAuthTag(Buffer.from(String(record.tag || ''), 'base64'))
          return Buffer.concat([
            decipher.update(Buffer.from(String(record.value || ''), 'base64')),
            decipher.final(),
          ]).toString('utf-8')
        } catch {}
      }
      return null
    }
    if (record.scheme === PLAIN_SCHEME) return String(record.value || '')
  } catch {}
  return null
}

export function encryptSecret(plain) {
  if (typeof plain !== 'string' || !plain) return null
  const record = encryptSecretRecord(plain)
  if (record.scheme === SAFE_STORAGE_SCHEME) return SAFE_PREFIX + record.value
  return AES_PREFIX + Buffer.from(JSON.stringify(record), 'utf-8').toString('base64')
}

export function decryptSecret(encoded) {
  if (typeof encoded !== 'string') return null
  if (encoded.startsWith(SAFE_PREFIX)) {
    return decryptSecretRecord({ scheme: SAFE_STORAGE_SCHEME, value: encoded.slice(SAFE_PREFIX.length) })
  }
  if (encoded.startsWith(AES_PREFIX)) {
    try {
      const record = JSON.parse(Buffer.from(encoded.slice(AES_PREFIX.length), 'base64').toString('utf-8'))
      return decryptSecretRecord(record)
    } catch {
      return null
    }
  }
  return null
}

export function isEncrypted(value) {
  return typeof value === 'string' && (value.startsWith(SAFE_PREFIX) || value.startsWith(AES_PREFIX))
}

const SECRET_NAME_RE = /(?:key|secret|token|password|credential)$/i

export function isSecretFieldName(name) {
  return typeof name === 'string' && SECRET_NAME_RE.test(name.replace(/[^a-z0-9]/gi, ''))
}

export function encryptSecretsDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') encryptSecretsDeep(value)
    else if (typeof value === 'string' && value && isSecretFieldName(key) && !isEncrypted(value)) {
      obj[key] = encryptSecret(value) || value
    }
  }
  return obj
}

export function decryptSecretsDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') decryptSecretsDeep(value)
    else if (isEncrypted(value)) {
      const plain = decryptSecret(value)
      if (plain != null) obj[key] = plain
    }
  }
  return obj
}

export function redactSecretsDeep(value) {
  if (Array.isArray(value)) return value.map(redactSecretsDeep)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSecretFieldName(key)
      ? { configured: Boolean(item) }
      : redactSecretsDeep(item)
  }
  return out
}

export const __internal = {
  AES_PREFIX,
  SAFE_PREFIX,
  fallbackMasterKey,
  fallbackMasterKeysForDecrypt,
}
