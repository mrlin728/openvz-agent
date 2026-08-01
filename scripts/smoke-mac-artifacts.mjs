#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const releaseBuild = process.env.OPENVZ_RELEASE_BUILD === '1'
const requested = process.argv.slice(2).map(value => value.replace(/^--arch=/, ''))
const targets = (requested.length ? requested : ['x64', 'arm64']).map(label => ({
  label,
  machArch: label === 'arm64' ? 'arm64' : 'x86_64',
}))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function requireFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`)
}

function assertArch(file, expected, label) {
  requireFile(file, label)
  const archs = run('lipo', ['-archs', file]).split(/\s+/).filter(Boolean)
  if (archs.length !== 1 || archs[0] !== expected) throw new Error(`${label} has [${archs.join(', ')}], expected ${expected}`)
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

for (const target of targets) {
  if (!['x64', 'arm64'].includes(target.label)) throw new Error(`unsupported architecture: ${target.label}`)
  const dmg = path.join(root, 'dist', `OpenVZ-Agent-mac-${target.label}.dmg`)
  const zip = path.join(root, 'dist', `OpenVZ-Agent-mac-${target.label}.zip`)
  const blockmap = `${zip}.blockmap`
  for (const [file, label] of [[dmg, 'DMG'], [zip, 'update ZIP'], [blockmap, 'ZIP blockmap']]) requireFile(file, `${target.label} ${label}`)

  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'openvz-dmg-'))
  try {
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg])
    const app = path.join(mount, 'OpenVZ Agent.app')
    const executable = path.join(app, 'Contents', 'MacOS', 'OpenVZ Agent')
    const unpacked = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked')
    const helper = path.join(unpacked, 'build', 'native-speech-recognizer')
    const sqlite = path.join(unpacked, 'node_modules', 'better-sqlite3', 'prebuilds', `darwin-${target.label}.node`)
    assertArch(executable, target.machArch, `${target.label} application`)
    assertArch(helper, target.machArch, `${target.label} speech helper`)
    assertArch(sqlite, target.machArch, `${target.label} better-sqlite3`)

    const browsers = path.join(app, 'Contents', 'Resources', 'playwright-browsers')
    const chromium = walk(browsers).find(file => /(?:Chromium|Google Chrome for Testing)\.app\/Contents\/MacOS\/(?:Chromium|Google Chrome for Testing)$/.test(file))
    if (!chromium) throw new Error(`${target.label} packaged Chromium executable is missing`)
    assertArch(chromium, target.machArch, `${target.label} packaged Chromium`)

    if (releaseBuild) {
      run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
      run('xcrun', ['stapler', 'validate', app])
      run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', chromium])
      console.log(`[smoke:mac-artifacts] ${target.label} architecture, nested signatures, Gatekeeper and notarization OK`)
    } else {
      console.log(`[smoke:mac-artifacts] ${target.label} development artifact architecture and bundled Chromium OK`)
    }
  } finally {
    spawnSync('hdiutil', ['detach', mount, '-quiet'], { encoding: 'utf8' })
    fs.rmSync(mount, { recursive: true, force: true })
  }
}
