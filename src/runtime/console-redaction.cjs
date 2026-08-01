const INSTALL_KEY = Symbol.for('openvz.consoleRedactionInstalled')
const SENSITIVE_KEY_RE = /(?:api[_-]?key|apikey|access[_-]?key|secret|token|password|authorization|bearer|credential|private[_-]?key)/i
const SECRET_LIKE_VALUE_RE = /\b(?:sk|ak|ark|rk|pk|ghp|github_pat|xox[abprs])-[-A-Za-z0-9_.]{10,180}\b/gi

function redactString(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|apikey|access[_-]?key|secret|token|password|authorization|credential)["']?\s*[=:]\s*["']?)[^\s,"';&}]+/gi, '$1[redacted]')
    .replace(SECRET_LIKE_VALUE_RE, '[redacted]')
}

function sanitizeConsoleArgument(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value)
  if (value === null || value === undefined || ['number', 'boolean', 'bigint'].includes(typeof value)) return value
  if (typeof value !== 'object') return redactString(value)
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: redactString(value.message || ''),
      stack: redactString(value.stack || ''),
    }
  }
  if (depth >= 4) return '[truncated]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeConsoleArgument(item, depth + 1, seen))

  const output = {}
  let entries = []
  try { entries = Object.entries(value).slice(0, 50) } catch { return '[unavailable object]' }
  for (const [key, item] of entries) {
    output[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitizeConsoleArgument(item, depth + 1, seen)
  }
  return output
}

function installConsoleRedaction(target = globalThis) {
  if (target[INSTALL_KEY]) return
  target[INSTALL_KEY] = true
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method]?.bind(console)
    if (!original) continue
    console[method] = (...args) => original(...args.map(arg => sanitizeConsoleArgument(arg)))
  }
}

installConsoleRedaction()

module.exports = { installConsoleRedaction, redactString, sanitizeConsoleArgument }
