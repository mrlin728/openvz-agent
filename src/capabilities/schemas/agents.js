// Agent 委派 / 工具市场类 schema：delegate_to_agent / grant_agent_delegation /
// install_tool / uninstall_tool / list_tools
export const agentsSchemas = {
  delegate_to_agent: {
    type: 'function',
    function: {
      name: 'delegate_to_agent',
      description: '将子任务委托给另一个本地 AI Agent 执行。仅在已获得用户授权（agent_delegation_allowed）时可用。适合代码开发、自动化任务等超出自身能力范围的场景。调用前必须通过 send_message 告知用户你打算让谁做什么。',
      parameters: {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            description: 'Agent ID，如 claude-code、codex、hermes、openclaw。',
            enum: ['claude-code', 'codex', 'hermes', 'openclaw']
          },
          prompt: {
            type: 'string',
            description: '发送给目标 Agent 的完整任务指令，应包含足够的上下文。'
          },
          context: {
            type: 'string',
            description: '可选：附加背景信息，会拼接到 prompt 前面。'
          },
          timeout: {
            type: 'number',
            description: '等待 Agent 响应的超时秒数，默认 60，最大 300。'
          }
        },
        required: ['agent_id', 'prompt']
      }
    }
  },

  grant_agent_delegation: {
    type: 'function',
    function: {
      name: 'grant_agent_delegation',
      description: '记录用户对 Agent 委托权限的决定。当用户明确表示同意或拒绝让 Bailongma 指挥其他 AI 小伙伴工作时调用此工具落盘。只调用一次，之后不再重复询问。',
      parameters: {
        type: 'object',
        properties: {
          allowed: {
            type: 'boolean',
            description: 'true 表示用户同意授权，false 表示用户拒绝。'
          },
          note: {
            type: 'string',
            description: '可选：用户原话或简短备注。'
          }
        },
        required: ['allowed']
      }
    }
  },

  install_tool: {
    type: 'function',
    function: {
      name: 'install_tool',
      description: '安装一个新工具并立即注册，下一轮对话起即可调用。工具代码是 async 函数体，可用变量：args（参数对象）、helpers.fetch（HTTP 请求）、helpers.exec(cmd)（运行 shell 命令，返回 stdout 字符串）、helpers.log(msg)（调试日志）。代码最终需要 return 一个字符串作为工具结果。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '工具名称，只能含小写字母、数字、下划线，以字母开头，长度 2-50。如 "weather_query"。'
          },
          description: {
            type: 'string',
            description: '工具描述：说明这个工具做什么、何时该调用它。'
          },
          parameters_schema: {
            type: 'object',
            description: 'JSON Schema 对象，描述工具的输入参数。格式：{ "type": "object", "properties": { ... }, "required": [...] }'
          },
          code: {
            type: 'string',
            description: 'async 函数体代码（不含 async function 声明头）。示例：const { city } = args; const r = await helpers.fetch(`https://wttr.in/${city}?format=3`); return await r.text();'
          }
        },
        required: ['name', 'description', 'parameters_schema', 'code']
      }
    }
  },

  uninstall_tool: {
    type: 'function',
    function: {
      name: 'uninstall_tool',
      description: '卸载一个已安装的工具，立即生效，同时删除其持久化文件。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '要卸载的工具名称。'
          }
        },
        required: ['name']
      }
    }
  },

  list_tools: {
    type: 'function',
    function: {
      name: 'list_tools',
      description: '列出所有可用工具（内置 + 已安装），含名称、描述、来源。适合安装前确认是否已存在、或排查工具问题。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
}
