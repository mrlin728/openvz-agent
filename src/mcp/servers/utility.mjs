// 内置 MCP server：utility —— 零依赖、纯离线、随安装包发布。
//
// 目的：让任何下载 OpenVZ Agent 的人，装完就立刻多出一批真实可用的新能力，
// 无需装 Node、无需 npx、无需联网、无需任何 token。
//
// 传输：newline-delimited JSON-RPC 2.0 over stdio（MCP stdio 标准）。
// 运行时：由主程序用 App 自带的 Electron/Node 运行时拉起（见 mcp/index.js）。

import crypto from 'crypto'

const TOOLS = [
  {
    name: 'calculate',
    description: '安全计算数学表达式（加减乘除、取余、乘方、括号）。示例：(12+8)*3/2 ** 2',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: '数学表达式' } },
      required: ['expression'],
    },
    run: ({ expression }) => calc(expression),
  },
  {
    name: 'datetime',
    description: '获取当前日期时间；可指定 IANA 时区（如 Asia/Shanghai、America/New_York）返回该时区本地时间。',
    inputSchema: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'IANA 时区名，可选' } },
    },
    run: ({ timezone }) => datetime(timezone),
  },
  {
    name: 'hash',
    description: '计算文本的哈希值。algo 支持 sha256（默认）、sha1、md5。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        algo: { type: 'string', enum: ['sha256', 'sha1', 'md5'] },
      },
      required: ['text'],
    },
    run: ({ text, algo = 'sha256' }) => {
      if (!['sha256', 'sha1', 'md5'].includes(algo)) throw new Error('unsupported algo')
      return `${algo}: ${crypto.createHash(algo).update(String(text ?? ''), 'utf-8').digest('hex')}`
    },
  },
  {
    name: 'uuid',
    description: '生成一个随机 UUID v4。',
    inputSchema: { type: 'object', properties: {} },
    run: () => crypto.randomUUID(),
  },
  {
    name: 'random_number',
    description: '生成 [min, max] 闭区间内的一个随机整数（默认 1..100）。',
    inputSchema: {
      type: 'object',
      properties: { min: { type: 'number' }, max: { type: 'number' } },
    },
    run: ({ min = 1, max = 100 }) => {
      const lo = Math.ceil(Number(min)), hi = Math.floor(Number(max))
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) throw new Error('invalid range')
      return String(lo + Math.floor(Math.random() * (hi - lo + 1)))
    },
  },
]

// —— 安全计算：只允许数字/空白/运算符/括号；出现任何字母都拒绝，
//    因此表达式里不可能引用到任何标识符，Function 求值是安全的。——
function calc(expr) {
  const s = String(expr ?? '').trim()
  if (!s) throw new Error('empty expression')
  if (s.length > 200) throw new Error('expression too long')
  if (!/^[0-9\s.+\-*/%()]+$/.test(s)) throw new Error('只允许数字与 + - * / % ( ) 运算符')
  let val
  try {
    // eslint-disable-next-line no-new-func
    val = Function(`"use strict";return (${s});`)()
  } catch {
    throw new Error('表达式无法计算')
  }
  if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error('结果非有限数')
  return String(val)
}

function datetime(timezone) {
  const now = new Date()
  const out = {
    iso: now.toISOString(),
    unix_ms: now.getTime(),
    local: now.toString(),
  }
  if (timezone) {
    try {
      out.timezone = timezone
      out.in_timezone = new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone, dateStyle: 'full', timeStyle: 'long',
      }).format(now)
    } catch {
      throw new Error(`未知时区：${timezone}`)
    }
  }
  return JSON.stringify(out, null, 2)
}

// ---- JSON-RPC over stdio ----

let buf = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    handle(msg)
  }
})

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n') }

function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'openvz-utility', version: '1.0.0' },
    }})
  } else if (method === 'notifications/initialized') {
    // notification, no reply
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }})
  } else if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name)
    if (!tool) {
      send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${params?.name}` } })
      return
    }
    try {
      const text = tool.run(params.arguments || {})
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(text) }] } })
    } catch (err) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `错误：${err.message}` }], isError: true } })
    }
  } else if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } })
  }
}
