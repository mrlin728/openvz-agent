// MCP 集成层 —— 对外 API 刻意与 marketplace/index.js 对称，
// 这样 executor / schemas / tool-router 的接线方式完全一致，改动最小。
//
// 命名空间：MCP 工具统一暴露为 `mcp__<server>__<tool>`，避免与内置工具/已安装工具重名。
// 例：filesystem server 的 read_file → `mcp__filesystem__read_file`。
//
// 配置文件：<userDir>/mcp.servers.json，格式与业界事实标准一致（mcpServers 字典），
// 可直接复用社区现成配置。示例见仓库根目录 mcp.servers.example.json。

import fs from 'fs'
import path from 'path'
import { paths } from '../paths.js'
import { McpStdioClient } from './client.js'

// 随安装包内置的默认配置（打包进 asar，位于资源目录下）。
const DEFAULT_CONFIG_FILE = path.join(paths.resourcesDir, 'src', 'mcp', 'servers.default.json')

const clients = new Map()       // serverName -> McpStdioClient
const toolIndex = new Map()     // 完整工具名 mcp__srv__tool -> { server, toolName, schema }

function sanitize(part = '') {
  return String(part || '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

function fullName(server, toolName) {
  return `mcp__${sanitize(server)}__${sanitize(toolName)}`
}

function readServersFrom(file) {
  try {
    if (!fs.existsSync(file)) return {}
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return raw?.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers : {}
  } catch (err) {
    console.log(`[mcp] 读取配置失败（${file}）：${err.message}`)
    return {}
  }
}

// 分层配置：先内置默认，再叠加用户配置（同名 server 用户覆盖，方便关掉/改参数）。
function readConfig() {
  const defaults = readServersFrom(DEFAULT_CONFIG_FILE)
  const user = readServersFrom(paths.mcpConfigFile)
  return { ...defaults, ...user }
}

// 把 App 自带运行时能跑的内置 server（runtime:'node'）解析成具体的 spawn 参数。
// - command 用 process.execPath：开发时是 node，打包后是 electron 二进制；
//   对 electron 设 ELECTRON_RUN_AS_NODE=1 让它以 Node 模式运行脚本。
// - 脚本路径优先取 asar.unpacked 下的真实文件（若存在），否则回落到 asar 内路径
//   （Electron 的 Node 运行时可直接读取 asar）。
function resolveServerSpec(spec = {}) {
  if (spec.runtime !== 'node') return spec
  const rel = spec.script
  if (!rel) return { ...spec, command: null }
  let scriptPath = path.join(paths.resourcesDir, rel)
  const unpacked = scriptPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  if (unpacked !== scriptPath && fs.existsSync(unpacked)) scriptPath = unpacked
  return {
    ...spec,
    command: process.execPath,
    args: [scriptPath, ...(spec.args || [])],
    env: { ...(spec.env || {}), ELECTRON_RUN_AS_NODE: '1' },
  }
}

// 启动时调用：连接所有已配置的 MCP server，建立工具索引。
// 与 loadInstalledTools() 对称，放在 index.js 启动序列里。
export async function loadMcpServers() {
  const servers = readConfig()
  const names = Object.keys(servers)
  if (names.length === 0) {
    console.log('[mcp] 未配置 MCP server（缺 mcp.servers.json，跳过）')
    return
  }
  toolIndex.clear()
  await Promise.all(names.map(async (name) => {
    // disabled: true 的 server 跳过，方便临时关掉而不删配置
    if (servers[name]?.disabled) return
    const client = new McpStdioClient(name, resolveServerSpec(servers[name]))
    clients.set(name, client)
    await client.connect()
    if (client.status !== 'ready') {
      console.log(`[mcp] server "${name}" 连接失败：${client.lastError || '未知'}`)
      return
    }
    for (const t of client.tools) {
      const fn = fullName(name, t.name)
      toolIndex.set(fn, {
        server: name,
        toolName: t.name,
        schema: {
          name: fn,
          description: `[MCP:${name}] ${t.description || t.name}`,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      })
    }
    console.log(`[mcp] server "${name}" 就绪，注册 ${client.tools.length} 个工具`)
  }))
  console.log(`[mcp] 共加载 ${toolIndex.size} 个 MCP 工具（来自 ${clients.size} 个 server）`)
}

// —— 与 marketplace 对称的查询/执行接口 ——

export function isMcpTool(name) {
  return toolIndex.has(name)
}

export function getMcpToolNames() {
  return [...toolIndex.keys()]
}

export function getMcpToolSchema(name) {
  return toolIndex.get(name)?.schema || null
}

export function listMcpTools() {
  return [...toolIndex.values()].map(t => ({
    name: fullName(t.server, t.toolName),
    server: t.server,
    description: t.schema.description,
  }))
}

export function listMcpServers() {
  return [...clients.values()].map(c => ({
    name: c.name,
    status: c.status,
    error: c.lastError || null,
    tools: c.tools.length,
  }))
}

export async function executeMcpTool(name, args) {
  const entry = toolIndex.get(name)
  if (!entry) return `错误：未知 MCP 工具 "${name}"`
  const client = clients.get(entry.server)
  if (!client) return `错误：MCP server "${entry.server}" 未连接`
  try {
    return await client.callTool(entry.toolName, args || {})
  } catch (err) {
    return `MCP 工具执行失败（${entry.server}/${entry.toolName}）：${err.message}`
  }
}

export function shutdownMcp() {
  for (const c of clients.values()) c.close()
  clients.clear()
  toolIndex.clear()
}
