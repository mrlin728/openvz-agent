import assert from 'node:assert/strict'
import {
  allowSensitiveAccess,
  corsAllowOrigin,
  isAllowedOrigin,
  isOpaqueOrigin,
  isSensitivePath,
} from './api/http-origin.js'

const LOOPBACK = 'http://127.0.0.1:3721'
const LAN = 'http://192.168.1.20:3721'
const EVIL = 'https://evil.example'

// --- opaque origin detection -------------------------------------------------
assert.equal(isOpaqueOrigin('null'), true, 'the literal string null is the opaque origin')
assert.equal(isOpaqueOrigin(''), false, 'an absent origin is a native client, not opaque')
assert.equal(isOpaqueOrigin(LOOPBACK), false)

// --- who may talk to the API at all -----------------------------------------
assert.equal(isAllowedOrigin(''), true, 'native clients send no Origin')
assert.equal(isAllowedOrigin(LOOPBACK), true)
assert.equal(isAllowedOrigin('http://localhost:3721'), true)
assert.equal(isAllowedOrigin(EVIL), false, 'named cross-site origins are refused')
assert.equal(isAllowedOrigin(LAN), false, 'LAN origins need LAN access enabled')
assert.equal(isAllowedOrigin(LAN, { lanEnabled: true }), true)
assert.equal(isAllowedOrigin('not a url'), false, 'unparseable origins are refused')

// --- sensitive route classification -----------------------------------------
for (const p of ['/activate', '/activate/prepare', '/settings', '/settings/heartbeat', '/admin/x', '/memories/1']) {
  assert.equal(isSensitivePath(p), true, `${p} holds credentials or history`)
}
for (const p of ['/message', '/status', '/panels', '/scene']) {
  assert.equal(isSensitivePath(p), false, `${p} is not sensitive`)
}

// --- the actual regression: Origin: null must not reach sensitive routes -----
// A page can mint an opaque origin with <iframe sandbox>, and the API listens
// on loopback, so loopback alone must not be enough.
assert.equal(
  allowSensitiveAccess({ origin: 'null', loopback: true }),
  false,
  'a sandboxed iframe must not read settings/memories even though it is loopback',
)
assert.equal(
  allowSensitiveAccess({ origin: LOOPBACK, loopback: true }),
  true,
  'the app itself still reaches sensitive routes',
)
assert.equal(
  allowSensitiveAccess({ origin: '', loopback: true }),
  true,
  'native loopback clients still reach sensitive routes',
)
assert.equal(
  allowSensitiveAccess({ origin: 'null', loopback: true, hasToken: true }),
  true,
  'an explicit API token proves the caller is not a drive-by page',
)
assert.equal(
  allowSensitiveAccess({ origin: LOOPBACK, loopback: false }),
  false,
  'a spoofed loopback Origin from off-box is still refused',
)

// --- CORS echo ---------------------------------------------------------------
assert.equal(
  corsAllowOrigin('null', { pathname: '/settings' }),
  '',
  'no Access-Control-Allow-Origin on a sensitive route, so the body stays unreadable',
)
assert.equal(
  corsAllowOrigin('null', { pathname: '/message' }),
  'null',
  'focus-banner.html is a file:// page and still needs its /message preflight answered',
)
assert.equal(corsAllowOrigin(LOOPBACK, { pathname: '/settings' }), LOOPBACK)
assert.equal(corsAllowOrigin(EVIL, { pathname: '/status' }), '', 'never echo a cross-site origin')
assert.equal(corsAllowOrigin('', { pathname: '/status' }), '', 'no Origin means no CORS header')
assert.notEqual(corsAllowOrigin(LOOPBACK, { pathname: '/status' }), '*', 'never a wildcard')

console.log('HTTP origin and CORS policy: OK')
