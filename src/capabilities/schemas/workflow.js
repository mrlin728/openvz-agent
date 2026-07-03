// 自进化工作流引擎工具 schema：plan_workflow / run_workflow / list_workflows / replay_workflow
// 由 src/workflow/engine.js 驱动：目标 → 拆分 → 逐步执行 → 每步评分 → 不达标重试 → 存成可复用工作流。
export const workflowSchemas = {
  plan_workflow: {
    type: 'function',
    function: {
      name: 'plan_workflow',
      description: 'Decompose a goal into an ordered, executable task list WITHOUT running it — a quick preview of the plan. Use when the user wants to see how a goal would be broken down before committing.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The overall goal to decompose.' },
        },
        required: ['goal'],
      },
    },
  },

  run_workflow: {
    type: 'function',
    function: {
      name: 'run_workflow',
      description: 'Run a full self-improving workflow for a goal: auto-decompose into steps, execute each step, score each result (0-100), auto-retry a step once when it falls below the pass threshold, then save the whole thing as a reusable workflow. Use when the user gives a concrete goal to accomplish end-to-end (research, drafting, multi-step tasks). This runs several LLM calls and may take a while.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The goal to accomplish end-to-end.' },
          name: { type: 'string', description: 'Optional name to save the reusable workflow under (defaults to the goal).' },
          max_steps: { type: 'number', description: 'Optional max steps, 2-6. Default 5.' },
          threshold: { type: 'number', description: 'Optional pass score 0-100. Default 75.' },
        },
        required: ['goal'],
      },
    },
  },

  list_workflows: {
    type: 'function',
    function: {
      name: 'list_workflows',
      description: 'List previously saved reusable workflows (name, step count, last overall score).',
      parameters: { type: 'object', properties: {} },
    },
  },

  replay_workflow: {
    type: 'function',
    function: {
      name: 'replay_workflow',
      description: 'Re-run a previously saved reusable workflow by name — replays its saved steps and re-scores them. Use to reuse a proven workflow.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name (or id) of the saved workflow to replay.' },
        },
        required: ['name'],
      },
    },
  },
}
