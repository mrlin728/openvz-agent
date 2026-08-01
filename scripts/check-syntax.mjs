#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const roots = ['src', 'electron', 'scripts']
const ignored = new Set(['node_modules', 'vendor', '__pycache__'])

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(?:js|mjs|cjs)$/.test(entry.name) ? [full] : []
  })
}

const files = roots.flatMap(dir => walk(path.join(root, dir)))
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`)
    process.exit(result.status || 1)
  }
}
console.log(`Syntax check: ${files.length} JavaScript modules OK`)
