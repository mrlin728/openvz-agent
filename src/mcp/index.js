// MCP 集成层 —— 对外 API 刻意与 marketplace/index.js 对称，
// 这样 executor / schemas / tool-router 的接线方式完全一致，改动最小。
//
// 命名空间：MCP 工具统一暴露为 `mcp__<server>__<tool>`，避免与内置工具/已安装工具重名。
// 例：filesystem server 的 read_file → `mcp__filesystem__read_file`。
//
// 配置文件：<userDir>/mcp.servers.json，格式与业界事实标准一致（mcpServers 字典），
// 可直接复用社区现成配置。示例见仓库根目录 mcp.servers.example.json。

import fs from 'fs'
import { paths } from '../paths.js'
import { McpStdioClient } from './client.js'

const clients = new Map()       // serverName -> McpStdioClient
const toolIndex = new Map()     // 完整工具名 mcp__srv__tool -> { server, toolName, schema }

function sanitize(part = '') {
  return String(part || '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
}

function fullName(server, toolName) {
  return `mcp__${sanitize(server)}__${sanitize(toolName)}`
}

function readConfig() {
  try {
    if (!fs.existsSync(paths.mcpConfigFile)) return {}
    const raw = JSON.parse(fs.readFileSync(paths.mcpConfigFile, 'utf-8'))
    return raw?.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers : {}
  } catch (err) {
    console.log(`[mcp] 读取配置失败：${err.message}`)
    return {}
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
    const client = new McpStdioClient(name, servers[name])
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
