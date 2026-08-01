# OpenVZ Agent 2.2.0

> Your Personal AI Agent OS — 一个持续运行、拥有长期记忆并能真实执行任务的本地桌面 Agent。

[下载 v2.2.0-rc.5](https://mrlin728.github.io/openvz-agent/) · [GitHub Releases](https://github.com/mrlin728/openvz-agent/releases) · [问题反馈](https://github.com/mrlin728/openvz-agent/issues)

OpenVZ Agent 不是一次问答后退出的聊天程序。它由主循环驱动，统一处理用户消息、长期任务、定时提醒、心跳、工具行动和多渠道回复，并把状态实时投影到 Brain UI。

## 下载安装

当前公开版本是 **v2.2.0-rc.5 未签名社区测试版**。它由 GitHub 托管的原生 Windows/macOS runner 从标签源码构建，但因为仓库尚未配置 Apple Developer ID 和 Azure Trusted Signing，系统会显示安全提醒。请只从本仓库下载并先核对 SHA-256；正式 `v2.2.0` 仍会强制签名和 Apple 公证。

| 系统 | 最低版本 | RC 下载 |
| --- | --- | --- |
| Windows x64 | Windows 10/11 | [OpenVZ-Agent-Setup.exe](https://github.com/mrlin728/openvz-agent/releases/download/v2.2.0-rc.5/OpenVZ-Agent-Setup.exe) |
| macOS Apple Silicon | macOS 12+，M1/M2/M3/M4 | [OpenVZ-Agent-mac-arm64.dmg](https://github.com/mrlin728/openvz-agent/releases/download/v2.2.0-rc.5/OpenVZ-Agent-mac-arm64.dmg) |
| macOS Intel | macOS 12+，Intel | [OpenVZ-Agent-mac-x64.dmg](https://github.com/mrlin728/openvz-agent/releases/download/v2.2.0-rc.5/OpenVZ-Agent-mac-x64.dmg) |

校验和见 [SHA256SUMS.txt](https://github.com/mrlin728/openvz-agent/releases/download/v2.2.0-rc.5/SHA256SUMS.txt)。Windows 核对哈希后运行安装包；若 SmartScreen 拦截，仅在确认文件来自本 Release 后选择“更多信息 → 仍要运行”。macOS 将应用拖入“应用程序”后，按住 Control 点按应用并选择“打开”；若仍被拦截，到“系统设置 → 隐私与安全性”选择“仍要打开”。不要全局关闭 Gatekeeper，也不要运行来路不明的绕过脚本。完整步骤、芯片判断和常见问题见下载页。

首次启动需要填写一个受支持模型服务商的 API Key。打包环境使用 Electron `safeStorage`；纯 Node 环境使用权限为 `0600` 的 AES-256-GCM 本机密钥存储，设置接口不会回显凭据。

## 2.2.0 能力

- 模块化本地 API、数据库 repository 和主循环，含启动进度、长期任务、LLM 心跳、发送失败去重与行动证据。
- Scene Protocol 与 SceneStore 单一 UI 状态源；`ui_set` 为规范入口，旧 `ui_show/ui_update/ui_patch/ui_hide/ui_register` 继续兼容。
- OpenVZ 工作流引擎、可视化工作流面板、配额与审查评分；工作流状态同步投影到 Scene。
- MCP 客户端、工具命名空间与加密配置；和内置能力、动态 API 槽统一进入选择、权限、执行与审计链路。
- 有状态 Playwright 浏览器：隔离持久 Profile、open/navigate/inspect/act/tabs/close、引用失效、私网 URL 防护与审计脱敏；安装包自带离线 Chromium。
- 本地 embedding、图片附件与视觉分析、终端流、软件安装、语音唤醒与 PTT、飞书/微信媒体、天气/台风/地图面板。
- Brain UI 活动持久化、主题、记忆图、思考流、人物卡、媒体与语音面板。

详细的 BaiLongma 同步基线、纳入功能和排除文件见 [UPSTREAM-SYNC.md](./UPSTREAM-SYNC.md)。

## 数据升级与兼容

2.2.0 会原地迁移 `config.json` 和 `data/jarvis.db`，迁移前在 `backups/v2.2.0/` 自动创建版本化备份。对话、记忆、任务、媒体、工作流、MCP 和动态能力配置均保留；失败迁移会自动尝试恢复备份。卸载默认不删除用户数据。

规范环境变量：

```text
OPENVZ_USER_DIR
OPENVZ_RESOURCES_DIR
OPENVZ_PORTABLE_DIR
OPENVZ_PORT
OPENVZ_HOST
OPENVZ_ALLOW_LAN
OPENVZ_API_TOKEN
OPENVZ_BROWSER_CHANNEL
```

OpenVZ Agent 2.x 继续接受对应的 `BAILONGMA_*` 旧名称。旧 renderer bridge、浏览器引用属性和 WebSocket 子协议也保留，现有扩展无需一次性重写。

## 本地开发

要求 Node.js 24：

```bash
npm ci
npm start
```

只启动后端：

```bash
npm run start:backend
```

默认监听 `http://127.0.0.1:3721`。常用入口：

| 路径 | 用途 |
| --- | --- |
| `/` / `/brain-ui` | 主界面 |
| `/status` | 运行状态 |
| `/settings/heartbeat` | 心跳设置 |
| `/workflows` | 工作流列表 |
| `/scene` | Scene WebSocket |
| `/site` | 与 GitHub Pages 共用的下载页 |

## 测试

```bash
npm run test:scene
npm run test:mcp
npm run test:upgrade
npm run test:browser-core
npm run test:websocket-security
npm run test:website
```

CI 在 Linux、Windows x64、macOS Intel 和 macOS Apple Silicon 上运行语法、核心单元、迁移、工作流、MCP、Scene、心跳、去重、能力槽和浏览器安全测试。Release 工作流在原生 runner 构建每个平台，最后由单一发布任务合并更新元数据并生成 SHA-256 文件。

## 构建与发布

```bash
npm run build:win
npm run build:mac:x64
npm run build:mac:arm64
```

正式发行构建设置 `OPENVZ_RELEASE_BUILD=1` 后，缺少签名或公证配置会立即失败，不会生成“看似正式”的未签名包。只有人工明确启用的 `v2.2.0-rc.N` 才允许走受保护的未签名社区 RC 流程，并会在 Release、下载页和产物中同时标识。实际配置与验收步骤见 `.github/workflows/release.yml`。

## 安全

- HTTP API 默认仅监听回环地址；LAN 与 token 访问需要显式配置。
- Electron 开启 `contextIsolation`，renderer 禁止 Node 权限，只暴露最小 preload bridge。
- 浏览器默认阻止 localhost、回环和私网地址；只有独立用户授权才能开启。
- 文件、Shell、浏览器、MCP、工作流和动态能力统一进入权限策略与工具审计。
- 配置、日志、API 响应与能力卡不得回显 API Key、token 或密码。

## License

[MIT](./LICENSE)。保留原作者声明；上游来源和同步记录见 [UPSTREAM-SYNC.md](./UPSTREAM-SYNC.md)。
