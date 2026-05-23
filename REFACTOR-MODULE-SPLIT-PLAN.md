# BaiLongma 模块拆分重构计划

目标：把超大文件拆成更细粒度、职责清晰、可测试、可继续扩展的功能模块，同时保持现有行为不变。

核心原则：
- 只做结构拆分，不改产品行为、工具协议、API JSON shape、数据库语义、UI 交互。
- 每次只拆一个清晰边界，拆完立即运行匹配的 smoke/test。
- 保留对外门面，避免打断现有 import。例如 `executor.js` 继续导出 `executeTool`、`autoSpeakForVoiceReply`、`persistAppState`。
- 不做无关格式化、文案调整、业务逻辑调整或依赖升级。
- 遇到必须改变行为才能继续的情况，停止并说明。

当前分支：`refactor/module-split`

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
- 版本已升到 `2.1.185`
- 已 build 并验证安装包：
  - `dist/Bailongma-Setup-2.1.185.exe`
- 已推送：
  - commit `dd4b1d5`
  - branch `origin/refactor/module-split`

已验证：
- `git diff --check`
- `node --check` 覆盖 `src` 下 JS/MJS
- `npm run smoke:tools`：6/6 passed
- `npm run smoke:brain-ui`：passed
- 安装包 build 成功，packaged/installed `better-sqlite3` 为 Electron ABI 130
- 安装版 `/status` HTTP 200
- 安装版真实对话链路验证：
  - 前台 `exec_command` 输出正常
  - 后台 `exec_command background=true` 正常返回 PID
  - `list_processes` 能看到后台进程
  - `kill_process` 能停止后台进程
  - `Get-ChildItem ..` 被安全策略拒绝

已知非回归：
- 本地 Node CLI 下 `better-sqlite3` 会因为 Electron ABI 130 与 Node ABI 127 不一致而打印/导致相关 Node CLI 数据库操作失败；不要把这个当成本次重构回归。安装版 Electron 已验证可启动并返回 `/status` 200。

## 剩余重构对象

### 1. `src/capabilities/executor.js`

当前状态：已拆出基础 helper、文件工具域、shell 工具域；`executor.js` 仍保留工具调度入口和大量其他工具实现。

剩余建议拆分顺序：
- `src/capabilities/tools/web.js`：`web_search`、`fetch_url`、`browser_read`、URL/search 缓存、网页正文保存相关逻辑。
- `src/capabilities/tools/memory.js`：`search_memory`、`upsert_memory`、`merge_memories`、`recall_memory`。
- `src/capabilities/tools/reminders.js`：`schedule_reminder`、`manage_reminder`、时间解析。
- `src/capabilities/tools/media.js`：`speak`、`generate_music`、`music`、`generate_image`。
- `src/capabilities/tools/ui.js`：`ui_show`、`ui_update`、`ui_hide`、`ui_patch`、`manage_app`、`ui_register`。
- `src/capabilities/tools/system.js`：`set_tick_interval`、`set_task`、`complete_task`、`set_security`、`set_agent_name` 等。
- `src/capabilities/tools/delegation.js`：Agent 委托相关工具。
- 后续可考虑 `src/capabilities/tool-registry.js`，把工具名到 handler 的 switch/注册表进一步拆出。

下一步建议：优先拆 `web.js`，因为它边界相对清晰，但涉及缓存、联网、文章保存和 browser fallback，需要更仔细保持 JSON/text shape。

### 2. `src/api.js`

建议拆分：
- `src/api.js`：保留 server 创建、CORS、安全入口、WebSocket upgrade 分发。
- `src/api/router.js`：轻量路由匹配和 handler 调用。
- `src/api/http-utils.js`：`jsonResponse`、`readJsonBody`、`contentTypeFor`、静态文件响应。
- `src/api/security.js`：loopback/LAN/token/origin 判断。
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
- brain UI 改动：跑 `npm run smoke:brain-ui`。
- 社交/微信/外部渠道改动：跑 `npm run smoke:social`，但注意本地 Node CLI ABI mismatch 的已知限制。
- build/启动路径改动：跑标准 Bailongma build 脚本并验证安装版 `/status`。

## 暂不做

- 不迁移到 TypeScript。
- 不引入 Express/Koa 等新 server 框架。
- 不重写数据库 schema。
- 不改变工具协议。
- 不改变 UI 视觉设计。
- 不做大规模格式化。
- 不在重构提交里升级依赖。
