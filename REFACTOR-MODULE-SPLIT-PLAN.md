# BaiLongma 模块拆分重构计划

目标：把超大文件拆成更细粒度、职责清晰、可测试、可持续扩展的功能模块，同时保持现有行为不变。

当前分支：`refactor/module-split`

## 核心原则

- 只做结构拆分，不改变产品行为、工具协议、API JSON shape、数据库语义、UI 交互。
- 每次只拆一个清晰边界，拆完立即运行匹配的 smoke/test。
- 保留对外门面，避免打断现有 import。例如 `executor.js` 继续导出 `executeTool`、`autoSpeakForVoiceReply`、`persistAppState`，并 re-export 仍被外部使用的 helper。
- 不做无关格式化、文档调整、业务逻辑调整或依赖升级。
- 遇到必须改变行为才能继续的情况，停止并说明。

## 已完成

- 基础安全/工具 helper 拆分：
  - `src/capabilities/tool-policy.js`
  - `src/capabilities/tool-audit.js`
  - `src/capabilities/tool-utils.js`
  - `src/capabilities/abort-utils.js`
  - `src/capabilities/sandbox.js`
- 文件工具域拆分：
  - `src/capabilities/tools/filesystem.js`
  - 包含 `read_file`、`list_dir`、`write_file`、`delete_file`、`make_dir`
- Shell 工具域拆分：
  - `src/capabilities/tools/shell.js`
  - 包含 `exec_command`、后台进程注册表、`list_processes`、`kill_process`、输出裁剪、cwd 解析、跨平台 shell spawn/PowerShell UTF-8 包装
- Web 工具域拆分：
  - `src/capabilities/tools/web.js`
  - 包含 `web_search`、`fetch_url`、`browser_read`
  - 包含 URL 缓存/TTL、`searchCache`、web config 短缓存、网页正文保存到 `sandbox/articles`、搜索 provider/fallback、Playwright/Chromium 读取逻辑
- Memory 工具域拆分：
  - `src/capabilities/tools/memory.js`
  - 包含 `search_memory`、`upsert_memory`、`merge_memories`、`recall_memory`、`downgrade_memory`、`skip_consolidation`、`skip_recognition`
  - 已迁移记忆参数 JSON 兼容解析、识别器/记忆写入辅助逻辑、`memory_consolidated` 事件和相关 `db.js` 记忆函数 import
- Reminders 工具域拆分：
  - `src/capabilities/tools/reminders.js`
  - 包含 `schedule_reminder` / `manage_reminder` 共用执行入口、一次性提醒创建/合并/取消/查询逻辑、周期提醒时间解析与下一次触发时间计算、提醒目标用户解析、`buildSystemMessage` helper、`reminder_created` / `reminder_merged` / `reminder_cancelled` 事件和相关 `db.js` import
  - `executor.js` 继续 re-export `calculateNextDueAt`，保持 `src/index.js` 兼容
- 出站回复体验小修：
  - `send_message` 写库/广播前对相邻重复短行做去重，避免同一条消息里出现“已取消 #1。\n已取消 #1。”
- `src/capabilities/executor.js` 继续保留工具调度门面和对外入口：
  - `executeTool`
  - `autoSpeakForVoiceReply`
  - `persistAppState`
- 当前版本：`2.1.189`
- 已 build 并验证安装包：
  - `dist/Bailongma-Setup-2.1.189.exe`
- 最新推送：
  - commit `c27072e`
  - branch `origin/refactor/module-split`

## 已验证

- `git diff --check`
- `node --check src/capabilities/executor.js`
- `node --check src/capabilities/tools/reminders.js`
- `node --check src/index.js`
- `npm run smoke:tools`：6/6 passed
- `npm run smoke:brain-ui`：passed
- reminders 最小工具调用验证：
  - `executeTool('manage_reminder', { action: 'noop' })`
  - `executeTool('schedule_reminder', {})`
  - 未创建真实提醒
- 安装版真实对话链路验证：
  - `/message` 创建测试提醒成功
  - DB 中测试提醒状态从 `pending` 变为 `cancelled`
  - 测试提醒已清理，无 pending 污染
- 出站去重验证：
  - 真实 `/message` 要求回复两行相同 token
  - conversations 最终只写入一行
- 标准 build 脚本成功，packaged/installed `better-sqlite3` 均为 Electron ABI 130
- 安装版 `/status` HTTP 200
- 安装版 `/brain-ui` Playwright 打开成功，主 UI 渲染正常

## 已知非回归

- 本地 Node CLI 中 `better-sqlite3` 可能因为 Electron ABI 130 与 Node ABI 127 不一致，导致涉及数据库写入的 Node CLI 脚本打印 audit 持久化警告；不要把这个当成本次重构回归。Electron 安装版已验证可启动并返回 `/status` 200。
- `brain.html` / `dashboard.html` 路由会 404，因为项目根目录本来没有对应文件；这不是本轮拆分导致的问题。
- Windows PowerShell 直接构造中文 JSON POST 时可能出现编码乱码；使用 UTF-8 bytes 或 ASCII 可避免。这不是 reminders 拆分导致的问题。

## 剩余重构对象

### 1. `src/capabilities/executor.js`

当前状态：已拆出基础 helper、文件工具域、shell 工具域、web 工具域、memory 工具域、reminders 工具域；`executor.js` 仍保留工具调度入口和大量其他工具实现。

剩余建议拆分顺序：

- `src/capabilities/tools/media.js`：`speak`、`generate_lyrics`、`generate_music`、`music`、`generate_image`
- `src/capabilities/tools/ui.js`：`ui_show`、`ui_update`、`ui_hide`、`ui_patch`、`manage_app`、`ui_register`、ACUI/组件草稿相关逻辑
- `src/capabilities/tools/system.js`：`set_tick_interval`、`set_task`、`complete_task`、`update_task_step`、`set_security`、`set_agent_name`、`set_location`、启动自检等
- `src/capabilities/tools/delegation.js`：agent 委托相关工具
- 后续可考虑 `src/capabilities/tool-registry.js`，把工具名到 handler 的 switch/注册表进一步拆出

下一步建议：优先拆 `media.js`。它体量较大但边界相对集中，涉及 TTS、歌词、音乐、图片、媒体库 DB 函数、配额、文件落盘和若干事件。必须保持工具名、参数、返回文本/JSON shape、错误文案、事件名和配额行为不变。

### 2. `src/api.js`

建议拆分：

- `src/api.js`：保留 server 创建、CORS、安全入口、WebSocket upgrade 分发
- `src/api/router.js`：轻量路由匹配和 handler 调用
- `src/api/http-utils.js`：`jsonResponse`、`readJsonBody`、`contentTypeFor`、静态文件响应
- `src/api/security.js`：loopback/LAN/token/origin 判断
- `src/api/routes/settings.js`
- `src/api/routes/memory.js`
- `src/api/routes/media.js`
- `src/api/routes/static.js`
- `src/api/routes/social.js`
- `src/api/routes/acui.js`
- `src/api/routes/voice.js`
- `src/api/routes/admin.js`

### 3. `src/db.js`

必须保留 `src/db.js` facade 和既有导出名。

建议拆分：

- `src/db/connection.js`
- `src/db/schema.js`
- `src/db/migrations.js`
- `src/db/json-utils.js`
- `src/db/repositories/config.js`
- `src/db/repositories/memories.js`
- `src/db/repositories/conversations.js`
- `src/db/repositories/reminders.js`
- `src/db/repositories/prefetch.js`
- `src/db/repositories/media.js`
- `src/db/repositories/action-logs.js`
- `src/db/repositories/ui-signals.js`
- `src/db/repositories/focus-stack.js`

### 4. `src/index.js`

建议在 executor/API/db 稳定后再动。

建议拆分：

- `src/runtime/state.js`
- `src/runtime/scheduler.js`
- `src/runtime/turn-runner.js`
- `src/runtime/context-builder.js`
- `src/runtime/fallback-reply.js`
- `src/runtime/startup.js`
- `src/runtime/awakening.js`

### 5. `src/ui/brain-ui/app.js`

建议结合 Playwright/smoke UI 验证。

建议拆分：

- `src/ui/brain-ui/main.js`
- `src/ui/brain-ui/graph/memory-graph.js`
- `src/ui/brain-ui/events/sse-client.js`
- `src/ui/brain-ui/settings/settings-panel.js`
- `src/ui/brain-ui/settings/model-settings.js`
- `src/ui/brain-ui/settings/voice-settings.js`
- `src/ui/brain-ui/media/music-panel.js`
- `src/ui/brain-ui/media/video-panel.js`
- `src/ui/brain-ui/tts/playback.js`
- `src/ui/brain-ui/focus/focus-stack.js`
- `src/ui/brain-ui/theme/theme.js`

## 每次开始前

- `git branch --show-current`
- `git status --short --branch`
- 阅读当前要拆的源文件和调用点。
- 明确本步边界：拆什么、不拆什么、必须保持哪些 public exports、需要跑哪些 smoke/test。

## 验证要求

- executor 工具域改动：至少跑 `node --check` 和 `npm run smoke:tools`。
- web 工具域改动：额外做 `fetch_url` / `browser_read` / `web_search` 的最小工具链路验证，避免依赖不稳定外网作为唯一判断。
- media 工具域改动：至少跑相关 `node --check`、`npm run smoke:tools`；尽量做不会消耗真实配额或污染媒体库的错误/只读路径验证。如果必须写入，说明原因并清理测试文件/记录。
- brain UI 改动：跑 `npm run smoke:brain-ui`。
- 社交/微信/外部渠道改动：跑 `npm run smoke:social`，但注意本地 Node CLI ABI mismatch 的已知限制。
- build/启动路径改动：跑标准 BaiLongma build 脚本并验证安装版 `/status`。

## 暂不做

- 不迁移到 TypeScript。
- 不引入 Express/Koa 等新 server 框架。
- 不重写数据库 schema。
- 不改变工具协议。
- 不改变 UI 视觉设计。
- 不做大规模格式化。
- 不在重构提交里升级依赖。
