#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] || 'release-output')
const output = path.join(root, 'SHA256SUMS.txt')
const files = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name !== 'SHA256SUMS.txt')
  .map(entry => entry.name)
  .sort()

const lines = files.map(name => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')
  return `${digest}  ${name}`
})
fs.writeFileSync(output, `${lines.join('\n')}\n`, 'utf-8')
console.log(`[release] wrote ${output} (${files.length} files)`)
