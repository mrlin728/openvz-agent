#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'

const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-release-metadata-'))
const input = path.join(temp, 'input')
const output = path.join(temp, 'output')

function run(script, ...args) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed:\n${result.stdout}\n${result.stderr}`)
}

function fixture(dir, name, content = name) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), content)
}

try {
  const windows = path.join(input, 'windows')
  const x64 = path.join(input, 'mac-x64')
  const arm64 = path.join(input, 'mac-arm64')
  for (const name of ['OpenVZ-Agent-Setup.exe', 'OpenVZ-Agent-Setup.exe.blockmap']) fixture(windows, name)
  fixture(windows, 'latest.yml', yaml.dump({ version: '2.2.0', path: 'OpenVZ-Agent-Setup.exe', sha512: 'win', files: [{ url: 'OpenVZ-Agent-Setup.exe', sha512: 'win' }] }))

  for (const [dir, arch] of [[x64, 'x64'], [arm64, 'arm64']]) {
    for (const ext of ['dmg', 'zip', 'zip.blockmap']) fixture(dir, `OpenVZ-Agent-mac-${arch}.${ext}`)
    fixture(dir, 'latest-mac.yml', yaml.dump({
      version: '2.2.0',
      path: `OpenVZ-Agent-mac-${arch}.zip`,
      sha512: arch,
      files: [{ url: `OpenVZ-Agent-mac-${arch}.zip`, sha512: arch }],
    }))
  }

  run('merge-release-metadata.mjs', input, output)
  run('generate-checksums.mjs', output)
  run('verify-release-assets.mjs', output)

  const merged = yaml.load(fs.readFileSync(path.join(output, 'latest-mac.yml'), 'utf8'))
  assert.ok(merged.files.some(file => file.url === 'OpenVZ-Agent-mac-x64.zip'))
  assert.ok(merged.files.some(file => file.url === 'OpenVZ-Agent-mac-arm64.zip'))
  const sums = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8')
  assert.match(sums, /OpenVZ-Agent-Setup\.exe/)
  assert.match(sums, /OpenVZ-Agent-mac-arm64\.dmg/)
  console.log('Release metadata merge, exact asset names and SHA-256 manifest: OK')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
