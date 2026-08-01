#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const tag = String(process.argv[2] || process.env.RELEASE_TAG || '').trim()

if (!/^v2\.2\.0(?:-rc\.[0-9]+)?$/.test(tag)) {
  throw new Error(`unsupported release tag: ${tag || '(empty)'}`)
}

const version = tag.slice(1)
const packageFile = path.join(root, 'package.json')
const lockFile = path.join(root, 'package-lock.json')
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'))

pkg.version = version
lock.version = version
if (lock.packages?.['']) lock.packages[''].version = version

fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`)
fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`)
console.log(`[release] package metadata set to ${version}`)
