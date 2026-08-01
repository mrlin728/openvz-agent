'use strict'

const assert = require('node:assert/strict')
const { DEFAULT_OPENVZ_PORT, resolvePreferredPort } = require('../electron/port-config.cjs')

assert.equal(resolvePreferredPort({}), DEFAULT_OPENVZ_PORT)
assert.equal(resolvePreferredPort({ OPENVZ_PORT: '3722' }), 3722)
assert.equal(resolvePreferredPort({ OPENVZ_PORT: ' 49152 ' }), 49152)
assert.equal(resolvePreferredPort({ BAILONGMA_PORT: '4721' }), 4721)
assert.equal(resolvePreferredPort({ OPENVZ_PORT: '3722', BAILONGMA_PORT: '4721' }), 3722)

for (const invalid of ['0', '65536', '-1', '3721.5', 'not-a-port']) {
  assert.equal(resolvePreferredPort({ OPENVZ_PORT: invalid }), DEFAULT_OPENVZ_PORT)
}

console.log('Electron OPENVZ_PORT and BAILONGMA_PORT compatibility: OK')
