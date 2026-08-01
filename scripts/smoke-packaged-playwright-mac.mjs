#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const arch = String(process.argv[2] || process.arch).replace(/^--arch=/, '')
if (!['x64', 'arm64'].includes(arch)) throw new Error(`unsupported architecture: ${arch}`)

const dmg = path.join(root, 'dist', `OpenVZ-Agent-mac-${arch}.dmg`)
assert.ok(fs.existsSync(dmg), `DMG is missing: ${dmg}`)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-packaged-browser-mac-'))
const mount = path.join(tempRoot, 'mount')
const userDir = path.join(tempRoot, 'user-data')
const probe = path.join(tempRoot, 'probe.mjs')
fs.mkdirSync(mount)
fs.mkdirSync(userDir)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout || ''}\n${result.stderr || ''}`)
  }
  return result.stdout.trim()
}

const probeSource = String.raw`
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const appAsar = process.env.OPENVZ_SMOKE_APP_ASAR
const resources = process.env.OPENVZ_PACKAGED_RESOURCES
const userDir = process.env.OPENVZ_USER_DIR
const requireFromAsar = createRequire(path.join(appAsar, 'package.json'))
const packagedRuntime = requireFromAsar('./electron/playwright-runtime.cjs')
packagedRuntime.configurePackagedPlaywright({
  isPackaged: true,
  resourcesPath: resources,
  platform: 'darwin',
  arch: process.arch,
})

assert.equal(process.env.OPENVZ_BROWSER_CHANNEL, 'chromium')
assert.equal(path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH), path.join(resources, 'playwright-browsers'))
assert.equal(process.env.OPENVZ_BUNDLED_PLAYWRIGHT, '1')

const managerUrl = pathToFileURL(path.join(appAsar, 'src', 'capabilities', 'tools', 'browser', 'index.js')).href
const { BrowserSessionManager } = await import(managerUrl)
const manager = new BrowserSessionManager({
  sandboxRoot: path.join(userDir, 'sandbox'),
  userDataRoot: userDir,
  operationTimeoutMs: 30_000,
})

let opened
try {
  opened = await manager.open({ url: 'about:blank', visible: false, timeout_ms: 30_000 })
  assert.equal(opened.ok, true)
  const inspect = await manager.inspect({ session_id: opened.session_id, screenshot: true })
  assert.equal(inspect.ok, true)
  const screenshot = path.resolve(userDir, 'sandbox', ...inspect.screenshot_path.split('/'))
  assert.ok(fs.existsSync(screenshot) && fs.statSync(screenshot).size > 0, 'packaged Chromium screenshot is empty')
  const closed = await manager.close({ session_id: opened.session_id })
  assert.equal(closed.closed, true)
  opened = null
  console.log(JSON.stringify({ ok: true, arch: process.arch, screenshotBytes: fs.statSync(screenshot).size }))
} finally {
  if (opened?.session_id) await manager.close({ session_id: opened.session_id }).catch(() => {})
  await manager.shutdown().catch(() => {})
}
`

fs.writeFileSync(probe, probeSource, { mode: 0o600 })

try {
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg])
  const app = path.join(mount, 'OpenVZ Agent.app')
  const resources = path.join(app, 'Contents', 'Resources')
  const appAsar = path.join(resources, 'app.asar')
  const executable = path.join(app, 'Contents', 'MacOS', 'OpenVZ Agent')
  for (const required of [appAsar, executable, path.join(resources, 'playwright-browsers')]) {
    assert.ok(fs.existsSync(required), `packaged browser smoke input is missing: ${required}`)
  }
  const output = run(executable, [probe], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: '',
      OPENVZ_SMOKE_APP_ASAR: appAsar,
      OPENVZ_PACKAGED_RESOURCES: resources,
      OPENVZ_USER_DIR: userDir,
      OPENVZ_RESOURCES_DIR: appAsar,
      OPENVZ_BROWSER_CHANNEL: 'chromium',
    },
  })
  const result = JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1))
  assert.equal(result.ok, true)
  assert.equal(result.arch, arch)
  assert.ok(result.screenshotBytes > 0)
  console.log(`macOS ${arch} packaged offline Chromium session and screenshot: OK`)
} finally {
  spawnSync('hdiutil', ['detach', mount, '-quiet'], { encoding: 'utf8' })
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
