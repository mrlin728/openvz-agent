#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const [inputRoot = 'release-input', outputRoot = 'release-output'] = process.argv.slice(2)
const inRoot = path.resolve(inputRoot)
const outRoot = path.resolve(outputRoot)

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const files = walk(inRoot)
fs.mkdirSync(outRoot, { recursive: true })

for (const file of files) {
  const base = path.basename(file)
  if (!['latest.yml', 'latest-mac.yml'].includes(base)) {
    fs.copyFileSync(file, path.join(outRoot, base))
  }
}

const windowsMetadata = files.find(file => path.basename(file) === 'latest.yml')
if (!windowsMetadata) throw new Error('latest.yml is missing from Windows artifacts')
fs.copyFileSync(windowsMetadata, path.join(outRoot, 'latest.yml'))

const macMetadata = files.filter(file => path.basename(file) === 'latest-mac.yml')
if (macMetadata.length !== 2) throw new Error(`expected two latest-mac.yml files, found ${macMetadata.length}`)
const parsed = macMetadata.map(file => yaml.load(fs.readFileSync(file, 'utf-8')))
const mergedFiles = []
const seen = new Set()
for (const metadata of parsed) {
  for (const item of metadata.files || []) {
    if (!item?.url || seen.has(item.url)) continue
    seen.add(item.url)
    mergedFiles.push(item)
  }
}

for (const arch of ['x64', 'arm64']) {
  if (!mergedFiles.some(item => String(item.url).includes(`-${arch}.zip`))) {
    throw new Error(`latest-mac.yml does not contain the ${arch} update ZIP`)
  }
}

const primary = mergedFiles.find(item => String(item.url).includes('-x64.zip')) || mergedFiles[0]
const merged = {
  ...parsed[0],
  files: mergedFiles,
  path: primary.url,
  sha512: primary.sha512,
  releaseDate: new Date().toISOString(),
}
fs.writeFileSync(path.join(outRoot, 'latest-mac.yml'), yaml.dump(merged, { lineWidth: -1 }), 'utf-8')
console.log(`[release] merged ${mergedFiles.length} macOS update assets into latest-mac.yml`)
