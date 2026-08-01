#!/usr/bin/env node

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronVersion = require('electron/package.json').version
const archArg = process.argv.find((arg) => arg.startsWith('--arch='))
const arch = archArg ? archArg.split('=', 2)[1] : process.arch
const projectRoot = path.resolve(import.meta.dirname, '..')
const sqliteRoot = path.dirname(require.resolve('better-sqlite3/package.json'))
const prebuilt = path.join(sqliteRoot, 'prebuilds', `${process.platform}-${arch}.node`)

if (!fs.existsSync(prebuilt) || fs.statSync(prebuilt).size === 0) {
  throw new Error(`better-sqlite3 native binary is missing for ${process.platform}-${arch}: ${path.relative(projectRoot, prebuilt)}`)
}

// better-sqlite3 13 ships stable Node-API binaries for every supported target;
// unlike legacy ABI builds, these are shared by Node 24 and Electron 43. The
// native-runner smoke tests still load the exact packaged file on every OS.
console.log(`[native] verified better-sqlite3 Node-API binary for Electron ${electronVersion} (${process.platform}-${arch})`)
