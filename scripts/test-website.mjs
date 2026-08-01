#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const html = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'website.html'), 'utf-8')

for (const [kind, asset] of [
  ['windows', 'OpenVZ-Agent-Setup.exe'],
  ['mac-arm64', 'OpenVZ-Agent-mac-arm64.dmg'],
  ['mac-x64', 'OpenVZ-Agent-mac-x64.dmg'],
]) {
  assert.match(html, new RegExp(`data-download="${kind}"[^>]+releases/latest/download/${asset.replaceAll('.', '\\.')}`))
}
for (const required of ['Windows 10 / 11', 'macOS 12', 'Apple Silicon', 'Intel', 'API Key', 'SHA256SUMS.txt', 'Azure Trusted Signing', 'Get-AuthenticodeSignature', 'spctl --assess', '<noscript>']) {
  assert.ok(html.includes(required), `download page must mention ${required}`)
}
assert.match(html, /@media \(max-width: 820px\)/)
assert.doesNotMatch(html, /HedwigsTheme|_tmp-feishu-token|actual[_ -]?api[_ -]?key/i)
console.log('Website download links and installation fallback: OK')
