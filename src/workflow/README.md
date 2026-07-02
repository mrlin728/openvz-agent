# 自进化工作流引擎（MVP）

一个目标 → 自动拆分任务 → 逐步执行 → 每步独立评分 → 不达标按建议重试 → 汇总为**可复用工作流**。

## 组成
- `engine.js` —— 核心逻辑（`planWorkflow` / `executeStep` / `scoreStep` / `runGoalWorkflow` / `replayWorkflow`）。LLM 以依赖注入方式传入，纯 Node 可跑、可测。
- `store.js` —— 工作流持久化（JSON 文件，可保存 / 读取 / 列表）。
- `engine.test.mjs` —— 离线单元测试（mock LLM，验证阈值 / 重试 / 评分 / 存取逻辑）。
- `../../scripts/workflow-mvp-demo.mjs` —— 可本机运行的端到端演示。

## 本机验证（用你自己的 Key）
```bash
# 方式一：环境变量指定 Key
LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-chat \
  node scripts/workflow-mvp-demo.mjs "帮我调研 3 个 AI Agent 产品并给出对比表"

# 方式二：直接复用 App 已配置的 Key（未加密时自动读取）
node scripts/workflow-mvp-demo.mjs "写一篇介绍 OpenVZ Agent 的短文"

# 只跑逻辑单测（不需要网络 / Key）
node src/workflow/engine.test.mjs
```

演示会实时打印：拆分步骤 → 每步执行与评分（带进度条）→ 总分 → 保存路径（`./workflows/*.json`）。

## 与现有能力的关系
- 评分复用了「独立审视」的思路（`src/review/`）；执行未来可接 `delegate_to_agent` 实现多 Agent 并行分工。
- 下一步（需在启动的 App 内用真实 Key 验证）：包装成 `plan_workflow` / `run_workflow` / `save_workflow` 工具接入 LLM 工具循环，并加一个 Brain UI 面板做可视化回放。
