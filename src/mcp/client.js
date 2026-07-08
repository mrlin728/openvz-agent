// 极简 MCP（Model Context Protocol）客户端 —— stdio 传输，零外部依赖。
//
// MCP 的 stdio 传输就是"一行一个 JSON-RPC 2.0 消息"（换行分隔，消息内不含裸换行）。
// 这里只实现 Host 侧需要的三件事：initialize 握手、tools/list、tools/call。
// 远程 SSE/HTTP 型 server 暂不支持（v1 聚焦本地 stdio，覆盖绝大多数社区 server）。
//
// 设计要点：
//   - 单个 server = 一个长驻子进程；崩溃后由上层 index.js 决定是否重连。
//   - 请求用自增 id 关联响应；notifications（无 id）忽略即可。
//   - 任何异常都不抛给主循环——连接失败标记 error，不拖垮 agent 启动。

import { spawn } from 'child_process'

const PROTOCOL_VERSION = '2024-11-05'
const REQUEST_TIMEOUT_MS = 30000

export class McpStdioClient {
  constructor(name, config = {}) {
    this.name = name
    this.config = config
    this.proc = null
    this.nextId = 1
    this.pending = new Map()   // id -> { resolve, reject, timer }
    this.buffer = ''
    this.tools = []            // [{ name, description, inputSchema }]
    this.status = 'idle'       // idle | connecting | ready | error
    this.lastError = null
  }

  async connect() {
    if (this.status === 'connecting' || this.status === 'ready') return
    this.status = 'connecting'
    const { command, args = [], env = {} } = this.config
    if (!command) {
      this.status = 'error'
      this.lastError = 'missing "command" in server config'
      return
    }

    try {
      this.proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...resolveEnv(env) },
      })
    } catch (err) {
      this.status = 'error'
      this.lastError = `spawn failed: ${err.message}`
      return
    }

    this.proc.stdout.setEncoding('utf-8')
    this.proc.stdout.on('data', (chunk) => this._onData(chunk))
    this.proc.stderr.on('data', (d) => {
      // MCP server 的日志走 stderr，不是协议数据，收集用于诊断即可。
      const line = String(d).trim()
      if (line) console.log(`[mcp:${this.name}] ${line.slice(0, 300)}`)
    })
    this.proc.on('exit', (code) => this._onExit(code))
    this.proc.on('error', (err) => {
      this.status = 'error'
      this.lastError = err.message
      this._rejectAll(err)
    })

    try {
      // 1) initialize 握手
      const init = await this._request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'openvz-agent', version: '1.0.0' },
      })
      this.serverInfo = init?.serverInfo || null
      // 2) 告知 server 握手完成
      this._notify('notifications/initialized', {})
      // 3) 拉取工具清单
      const listed = await this._request('tools/list', {})
      this.tools = Array.isArray(listed?.tools) ? listed.tools : []
      this.status = 'ready'
    } catch (err) {
      this.status = 'error'
      this.lastError = `handshake failed: ${err.message}`
    }
  }

  async callTool(toolName, args = {}) {
    if (this.status !== 'ready') {
      throw new Error(`MCP server "${this.name}" not ready (${this.status}: ${this.lastError || ''})`)
    }
    const res = await this._request('tools/call', { name: toolName, arguments: args || {} })
    return normalizeToolResult(res)
  }

  close() {
    try { this.proc?.kill() } catch {}
    this._rejectAll(new Error('client closed'))
    this.status = 'idle'
  }

  // ---- 内部 JSON-RPC 机制 ----

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request "${method}" timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this._send({ jsonrpc: '2.0', id, method, params })
    })
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params })
  }

  _send(msg) {
    try {
      this.proc.stdin.write(JSON.stringify(msg) + '\n')
    } catch (err) {
      this._rejectAll(err)
    }
  }

  _onData(chunk) {
    this.buffer += chunk
    let idx
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id)
        clearTimeout(timer)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || 'RPC error'))
        else resolve(msg.result)
      }
      // 无 id 的 notification：当前不需要处理
    }
  }

  _onExit(code) {
    if (this.status !== 'idle') {
      this.status = 'error'
      this.lastError = `process exited (code ${code})`
    }
    this._rejectAll(new Error(`MCP server "${this.name}" exited`))
  }

  _rejectAll(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      try { reject(err) } catch {}
    }
    this.pending.clear()
  }
}

// 把 config.env 里的 "${VAR}" 占位替换成宿主环境变量，方便配置里引用 token。
function resolveEnv(env) {
  const out = {}
  for (const [k, v] of Object.entries(env || {})) {
    out[k] = String(v).replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? '')
  }
  return out
}

// MCP tools/call 返回 { content: [{type,text|...}], isError }，
// 拍平成 agent 工具执行器习惯的字符串结果。
function normalizeToolResult(res) {
  if (!res) return '（MCP 工具无返回）'
  const parts = Array.isArray(res.content) ? res.content : []
  const text = parts
    .map(p => {
      if (p?.type === 'text') return p.text
      if (p?.type === 'image') return '[图片]'
      if (p?.type === 'resource') return `[资源] ${p.resource?.uri || ''}`
      return typeof p === 'string' ? p : JSON.stringify(p)
    })
    .filter(Boolean)
    .join('\n')
  if (res.isError) return `MCP 工具报错：${text || '(无详情)'}`
  return text || '（MCP 工具执行成功，无文本输出）'
}
