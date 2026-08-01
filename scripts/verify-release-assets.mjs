#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] || 'release-output')
const required = [
  'OpenVZ-Agent-Setup.exe',
  'OpenVZ-Agent-mac-x64.dmg',
  'OpenVZ-Agent-mac-x64.zip',
  'OpenVZ-Agent-mac-arm64.dmg',
  'OpenVZ-Agent-mac-arm64.zip',
  'latest.yml',
  'latest-mac.yml',
  'SHA256SUMS.txt',
]

const missing = required.filter(name => !fs.existsSync(path.join(root, name)))
if (missing.length) throw new Error(`missing release assets: ${missing.join(', ')}`)

const blockmaps = fs.readdirSync(root).filter(name => name.endsWith('.blockmap'))
for (const prefix of ['OpenVZ-Agent-Setup.exe', 'OpenVZ-Agent-mac-x64.zip', 'OpenVZ-Agent-mac-arm64.zip']) {
  if (!blockmaps.some(name => name.startsWith(prefix))) throw new Error(`missing blockmap for ${prefix}`)
}

const checksums = fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf-8')
for (const name of required.filter(name => name !== 'SHA256SUMS.txt')) {
  if (!checksums.includes(`  ${name}\n`)) throw new Error(`checksum entry missing for ${name}`)
}
console.log('[release] asset names, metadata, blockmaps and checksums are complete')
