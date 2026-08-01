#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const html = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'website.html'), 'utf-8')
assert.doesNotMatch(html, /v2\.2\.0-rc\.[12345678]/, 'download page must not retain failed candidate tags')

for (const [kind, asset] of [
  ['windows', 'OpenVZ-Agent-Setup.exe'],
  ['mac-arm64', 'OpenVZ-Agent-mac-arm64.dmg'],
  ['mac-x64', 'OpenVZ-Agent-mac-x64.dmg'],
]) {
  assert.match(html, new RegExp(`data-download="${kind}"[^>]+releases/download/v2\\.2\\.0-rc\\.9/${asset.replaceAll('.', '\\.')}`))
}
for (const required of ['Windows 10 / 11', 'macOS 12', 'Apple Silicon', 'Intel', 'API Key', 'SHA256SUMS.txt', 'UNSIGNED-BUILD.txt', '未签名社区', 'Azure Trusted Signing', 'SmartScreen', 'NotSigned', 'Get-AuthenticodeSignature', 'Control', '隐私与安全性', 'spctl --assess', '<noscript>']) {
  assert.ok(html.includes(required), `download page must mention ${required}`)
}
assert.match(html, /@media \(max-width: 820px\)/)
assert.doesNotMatch(html, /releases\/latest\/download/)
assert.ok(html.includes('不要全局关闭 Gatekeeper'))
assert.doesNotMatch(html, /HedwigsTheme|_tmp-feishu-token|actual[_ -]?api[_ -]?key/i)
console.log('Website download links and installation fallback: OK')
