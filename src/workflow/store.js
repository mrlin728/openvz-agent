// workflow/store.js — 可复用工作流的持久化（MVP：目录下的 JSON 文件）。
//
// 刻意不依赖 SQLite，保持引擎在纯 Node 下可用、可测。App 内可传入 paths.userDir 下的
// 目录；demo 脚本可传入 ./workflows。文件名用 slug 化后的工作流名，稳定可读。

import fs from 'node:fs'
import path from 'node:path'

const slug = (name) => String(name || 'workflow')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || 'workflow'

export function saveWorkflow(dir, name, workflow) {
  fs.mkdirSync(dir, { recursive: true })
  const id = slug(name)
  const file = path.join(dir, `${id}.json`)
  const record = { id, name: String(name || id), savedAt: new Date().toISOString(), ...workflow }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
  return { id, file }
}

export function loadWorkflow(dir, nameOrId) {
  const id = slug(nameOrId)
  const file = path.join(dir, `${id}.json`)
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

export function listWorkflows(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        return { id: w.id, name: w.name, goal: w.goal, steps: (w.steps || []).length, overallScore: w.overallScore, savedAt: w.savedAt }
      } catch { return null }
    })
    .filter(Boolean)
}
