// Origin decisions for the local HTTP API.
//
// The API binds to loopback, so `isLoopbackRequest` is true for *any* process
// on the machine — including the user's ordinary web browser. That makes the
// Origin check, not the address check, the thing standing between a random web
// page and this agent's data.
//
// Named cross-site origins are already rejected: `https://evil.example` is
// neither loopback nor private-LAN. The gap is the opaque origin. A page can
// mint one at will —
//
//   <iframe sandbox="allow-scripts" srcdoc="<script>fetch('http://127.0.0.1:3721/…')</script>">
//
// — and every request from that frame carries `Origin: null`. Treating `null`
// as loopback handed any website the same reach the app itself has, including
// /settings (API keys), /admin and /memories (conversation history).
//
// `null` cannot be refused outright yet: focus-banner.html is loaded from
// file:// and POSTs /message, so it is a legitimate opaque-origin caller, and
// its JSON content type means the preflight must be answered. So the rule is
// scoped by route instead:
//
//   * sensitive routes  — opaque origins are refused, and get no CORS headers
//   * everything else   — the preflight is still answered so the banner works
//
// Residual risk: a sandboxed frame can still reach non-sensitive routes such
// as /status or /panels. Closing that means giving focus-banner.html a real
// origin — serve it over http://127.0.0.1 the way activation.html already is,
// after which `null` can be refused everywhere, here and in the WebSocket
// upgrade path.

import { isLoopbackAddress, isPrivateLanAddress } from './websocket-security.js'

/** `null` is the opaque origin: sandboxed iframes, file:// documents. */
export function isOpaqueOrigin(origin) {
  return String(origin || '') === 'null'
}

/** Routes that expose credentials, settings or stored conversation content. */
export function isSensitivePath(pathname = '') {
  return pathname === '/activate'
    || pathname === '/activate/prepare'
    || pathname === '/settings'
    || pathname.startsWith('/settings/')
    || pathname.startsWith('/admin/')
    || pathname.startsWith('/memories/')
}

/**
 * Can a request carrying this Origin talk to the API at all?
 * An absent Origin means a native client (curl, the Electron main process).
 */
export function isAllowedOrigin(origin, { lanEnabled = false } = {}) {
  if (!origin) return true
  if (isOpaqueOrigin(origin)) return true // narrowed per-route below
  try {
    const { hostname } = new URL(origin)
    if (isLoopbackAddress(hostname)) return true
    return lanEnabled && isPrivateLanAddress(hostname)
  } catch {
    return false
  }
}

/**
 * The value to echo in Access-Control-Allow-Origin, or '' for no header.
 * Never a wildcard, and never `null` on a sensitive route.
 */
export function corsAllowOrigin(origin, { lanEnabled = false, pathname = '' } = {}) {
  if (!origin) return ''
  if (isOpaqueOrigin(origin)) return isSensitivePath(pathname) ? '' : 'null'
  return isAllowedOrigin(origin, { lanEnabled }) ? origin : ''
}

/**
 * May this request reach a sensitive route?
 *
 * `loopback` and `hasToken` come from the caller (address check / bearer
 * token). An opaque origin is refused even from loopback, because that is
 * exactly the drive-by browser-tab case being defended against. A valid token
 * still passes: presenting one proves the caller is not a drive-by page.
 */
export function allowSensitiveAccess({ origin, loopback = false, hasToken = false } = {}) {
  if (hasToken) return true
  if (isOpaqueOrigin(origin)) return false
  return loopback
}
