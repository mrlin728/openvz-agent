import path from 'node:path'
import { jsonResponse } from '../utils.js'
import { paths } from '../../paths.js'
import { listWorkflows } from '../../workflow/store.js'

export async function handleWorkflowRoutes(req, res, url) {
  if (req.method !== 'GET' || url.pathname !== '/workflows') return false
  try {
    jsonResponse(res, 200, { ok: true, workflows: listWorkflows(path.join(paths.userDir, 'workflows')) })
  } catch (error) {
    jsonResponse(res, 200, { ok: true, workflows: [], error: error.message })
  }
  return true
}
