'use strict'

const DEFAULT_OPENVZ_PORT = 3721

function resolvePreferredPort(env = process.env) {
  const raw = String(env.OPENVZ_PORT || env.BAILONGMA_PORT || '').trim()
  if (!raw) return DEFAULT_OPENVZ_PORT
  if (!/^\d+$/.test(raw)) return DEFAULT_OPENVZ_PORT

  const port = Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : DEFAULT_OPENVZ_PORT
}

module.exports = { DEFAULT_OPENVZ_PORT, resolvePreferredPort }
