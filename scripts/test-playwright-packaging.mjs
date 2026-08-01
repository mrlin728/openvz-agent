#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveTargets } from './prepare-playwright-browsers.mjs'
import { getPrimaryChromiumLaunchOptions } from '../src/capabilities/tools/web/browser.js'
import { launchBrowser } from '../src/capabilities/tools/browser/runtime.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const mainSource = readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const macBuildSource = readFileSync(path.join(root, 'scripts', 'build-mac.mjs'), 'utf8')
const installerSource = readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8')
const gitignore = readFileSync(path.join(root, '.gitignore'), 'utf8')
const require = createRequire(import.meta.url)
const runtime = require('../electron/playwright-runtime.cjs')
const builderConfig = require('../electron-builder.config.cjs')

assert.equal(pkg.dependencies.playwright, '1.59.1')
assert.equal(pkg.dependencies['playwright-core'], '1.59.1')
assert.equal(pkg.devDependencies.playwright, undefined)
assert.equal(pkg.dependencies['better-sqlite3'], '13.0.2')
assert.equal(pkg.devDependencies['7zip-bin'], '5.2.0')
assert.ok(existsSync(path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')), 'NSIS repair extractor must be installed explicitly')
assert.ok(builderConfig.asarUnpack.includes('**/node_modules/better-sqlite3/prebuilds/*.node'))
assert.match(mainSource, /prebuilds.*\$\{PLATFORM\}-\$\{process\.arch\}\.node/)
assert.match(installerSource, /better-sqlite3\\prebuilds\\win32-x64\.node/)
assert.doesNotMatch(installerSource, /better-sqlite3\\build\\Release\\better_sqlite3\.node/)
assert.match(installerSource, /Recognized legacy Bailongma install directory; upgrading in place/)
assert.match(installerSource, /StrCmp \$R2 "Bailongma\.exe"/)
assert.deepEqual(builderConfig.extraResources, [{
  from: 'build/playwright-browsers/${os}-${arch}',
  to: 'playwright-browsers',
  filter: ['**/*'],
}])
for (const name of ['build', 'build:win']) {
  const script = pkg.scripts[name]
  assert.ok(script.indexOf('prebuild-clean.mjs') < script.indexOf('prepare-playwright-browsers.mjs'), `${name} must clean before staging`)
  assert.ok(script.indexOf('prepare-playwright-browsers.mjs') < script.lastIndexOf('electron-builder'), `${name} must stage before electron-builder`)
}
assert.ok(macBuildSource.indexOf('prebuild-clean.mjs') < macBuildSource.indexOf('prepare-playwright-browsers.mjs'))
assert.ok(macBuildSource.indexOf('prepare-playwright-browsers.mjs') < macBuildSource.indexOf('electron-builder'))
assert.ok(mainSource.indexOf('configurePackagedPlaywright') < mainSource.indexOf('await import(pathToFileURL(BACKEND_ENTRY)'))
assert.match(gitignore, /^build\/playwright-browsers\/$/m)

assert.deepEqual(resolveTargets([], 'win32').map((target) => target.builderKey), ['win-x64'])
assert.deepEqual(resolveTargets([], 'darwin').map((target) => target.builderKey), ['mac-x64', 'mac-arm64'])
assert.equal(runtime.packagedHostPlatform('darwin', 'arm64'), 'mac15-arm64')
const env = {}
assert.equal(runtime.configurePackagedPlaywright({
  isPackaged: true,
  resourcesPath: path.join(root, 'fake-resources'),
  platform: 'win32',
  arch: 'x64',
  env,
}), path.join(root, 'fake-resources', 'playwright-browsers'))
assert.equal(env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE, 'win64')
assert.equal(env.OPENVZ_BUNDLED_PLAYWRIGHT, '1')
assert.equal(env.BAILONGMA_BUNDLED_PLAYWRIGHT, '1')
assert.deepEqual(getPrimaryChromiumLaunchOptions(env), { headless: true, channel: 'chrome' })
assert.deepEqual(getPrimaryChromiumLaunchOptions({ PLAYWRIGHT_BROWSERS_PATH: 'shared-cache' }), { headless: true, channel: 'chrome' })
assert.deepEqual(getPrimaryChromiumLaunchOptions({}), { headless: true, channel: 'chrome' })
assert.deepEqual(getPrimaryChromiumLaunchOptions({ BAILONGMA_BROWSER_CHANNEL: 'chromium' }), { headless: true, channel: 'chromium' })
assert.deepEqual(getPrimaryChromiumLaunchOptions({ OPENVZ_BROWSER_CHANNEL: 'chromium' }), { headless: true, channel: 'chromium' })
assert.throws(
  () => getPrimaryChromiumLaunchOptions({ OPENVZ_BROWSER_CHANNEL: 'firefox' }),
  /Unsupported OPENVZ_BROWSER_CHANNEL/,
)

const originalBundledFlag = process.env.OPENVZ_BUNDLED_PLAYWRIGHT
process.env.OPENVZ_BUNDLED_PLAYWRIGHT = '1'
try {
  const calls = []
  const bundledBrowser = { kind: 'bundled-chromium' }
  const result = await launchBrowser({
    async launch(options) {
      calls.push(options.channel)
      if (options.channel === 'chromium') return bundledBrowser
      throw new Error(`${options.channel} is unavailable`)
    },
  }, { headless: true, channel: 'chrome' })
  assert.equal(result, bundledBrowser)
  assert.deepEqual(calls, ['chrome', 'msedge', 'chromium'])
} finally {
  if (originalBundledFlag === undefined) delete process.env.OPENVZ_BUNDLED_PLAYWRIGHT
  else process.env.OPENVZ_BUNDLED_PLAYWRIGHT = originalBundledFlag
}

console.log('Playwright packaging configuration: OK')
