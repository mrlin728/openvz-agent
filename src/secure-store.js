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
