// secure-store.js — 用 Electron safeStorage（走系统钥匙串 / Keychain）加密静态密钥。
//
// 背景：后端由 electron/main.cjs 通过 `import()` 拉进【同一个 Electron 主进程】运行，
// 所以这里能直接拿到 electron 的 safeStorage。若以纯 Node 方式独立运行后端
// （npm run start:backend），electron 模块不可用 → 自动回退为“明文透传”，行为与旧版一致，
// 保证密钥仍能保存、应用不会因为缺少加密而无法激活。
//
// 存储格式：加密后写成 `v1:<base64>`，解密时按前缀识别；非本前缀的一律当明文旧数据处理。

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let safeStorage = null
try {
  // electron 是 CJS 模块，用 createRequire 引最稳妥；纯 Node 下会抛错，被 catch 吞掉。
  safeStorage = require('electron').safeStorage || null
} catch {
  safeStorage = null
}

const PREFIX = 'v1:'

export function isSecureStoreAvailable() {
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable())
  } catch {
    return false
  }
}

// 明文 → `v1:<base64>`；不可用或失败时返回 null（调用方据此回退为明文存储）。
export function encryptSecret(plain) {
  if (typeof plain !== 'string' || !plain) return null
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {}
  return null
}

// `v1:<base64>` → 明文；非本格式或解密失败返回 null。
export function decryptSecret(enc) {
  if (typeof enc !== 'string' || !enc.startsWith(PREFIX)) return null
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc.slice(PREFIX.length), 'base64'))
    }
  } catch {}
  return null
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

// 字段名以 key / secret / token / password 结尾（大小写不敏感）视为敏感字段。
// 这样能覆盖 volcAsrApiKey / doubaoKey / botToken / appSecret / xunfeiApiSecret /
// serper_api_key / jina_api_key / verificationToken 等驼峰与下划线两种命名，
// 又不会误伤 resourceId / voiceId / appId / url 之类非密字段。
const SECRET_NAME_RE = /(?:key|secret|token|password)$/i

export function isSecretFieldName(name) {
  return typeof name === 'string' && SECRET_NAME_RE.test(name)
}

// 递归就地加密：对敏感字段名、且值为非空明文字符串的项加密。已加密（v1:）跳过，幂等。
export function encryptSecretsDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      encryptSecretsDeep(v)
    } else if (typeof v === 'string' && v && isSecretFieldName(k) && !isEncrypted(v)) {
      const enc = encryptSecret(v)
      if (enc) obj[k] = enc // safeStorage 不可用时保持明文，不破坏保存
    }
  }
  return obj
}

// 递归就地解密：把任何 v1: 前缀的字符串还原成明文（不按字段名筛，安全）。
export function decryptSecretsDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      decryptSecretsDeep(v)
    } else if (isEncrypted(v)) {
      const dec = decryptSecret(v)
      if (dec != null) obj[k] = dec
    }
  }
  return obj
}
