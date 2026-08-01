// Compatibility schemas for OpenVZ 2.1 ACUI callers. New agents should use
// ui_set; these names remain available for extensions and saved workflows.
export const acuiCompatibilitySchemas = {
  ui_show: {
    type: 'function',
    function: {
      name: 'ui_show',
      description: 'Compatibility adapter: show a legacy ACUI component by projecting it into the canonical SceneStore. Prefer ui_set for new calls.',
      parameters: {
        type: 'object',
        properties: {
          component: { type: 'string' }, props: { type: 'object' }, hint: { type: 'object' },
          mode: { type: 'string', enum: ['inline-template', 'inline-script'] },
          template: { type: 'string' }, code: { type: 'string' },
        },
      },
    },
  },
  ui_hide: {
    type: 'function',
    function: { name: 'ui_hide', description: 'Compatibility adapter: remove a legacy ACUI card from SceneStore.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  },
  ui_update: {
    type: 'function',
    function: { name: 'ui_update', description: 'Compatibility adapter: update legacy card props through SceneStore.', parameters: { type: 'object', properties: { id: { type: 'string' }, props: { type: 'object' } }, required: ['id', 'props'] } },
  },
  ui_patch: {
    type: 'function',
    function: { name: 'ui_patch', description: 'Compatibility adapter: record an operation/state patch on a SceneStore surface.', parameters: { type: 'object', properties: { id: { type: 'string' }, op: { type: 'string' }, data: { type: 'object' } }, required: ['id', 'op'] } },
  },
  ui_register: {
    type: 'function',
    function: {
      name: 'ui_register',
      description: 'Compatibility adapter for registering an existing ACUI component. New UI vocabulary should be added as a reviewed Scene kind.',
      parameters: {
        type: 'object',
        properties: { component_name: { type: 'string' }, code: { type: 'string' }, props_schema: { type: 'object' }, use_case: { type: 'string' }, example_call: { type: 'string' } },
        required: ['component_name', 'code', 'props_schema', 'use_case', 'example_call'],
      },
    },
  },
}
