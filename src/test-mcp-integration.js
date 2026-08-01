import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-mcp-'))
process.env.OPENVZ_USER_DIR = temp
process.env.OPENVZ_RESOURCES_DIR = path.resolve('.')
fs.writeFileSync(path.join(temp, 'mcp.servers.json'), JSON.stringify({
  mcpServers: {
    disabled_example: { disabled: true, command: 'unused', env: { ACCESS_TOKEN: 'fixture-secret' } },
  },
}, null, 2), { mode: 0o600 })

const mcp = await import('./mcp/index.js')
try {
  await mcp.loadMcpServers()
  const name = 'mcp__utility__calculate'
  assert.equal(mcp.isMcpTool(name), true)
  assert.equal(mcp.getMcpToolSchema(name)?.type, 'function')
  assert.equal(mcp.getMcpToolSchema(name)?.function?.name, name)
  assert.equal(await mcp.executeMcpTool(name, { expression: '(12+8)*3/2' }), '30')
  assert.ok(mcp.getMcpToolNames().includes('mcp__utility__hash'))
  const persisted = fs.readFileSync(path.join(temp, 'mcp.servers.json'), 'utf-8')
  assert.doesNotMatch(persisted, /fixture-secret/)
  assert.match(persisted, /v2:/)
} finally {
  mcp.shutdownMcp()
  fs.rmSync(temp, { recursive: true, force: true })
}
console.log('MCP namespace, execution and encrypted config: OK')
