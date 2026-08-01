#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8')
const smoke = fs.readFileSync(path.join(root, 'scripts', 'smoke-windows-install.ps1'), 'utf8')
const versionScript = fs.readFileSync(path.join(root, 'scripts', 'prepare-release-version.mjs'), 'utf8')
const buildMac = fs.readFileSync(path.join(root, 'scripts', 'build-mac.mjs'), 'utf8')
const smokeMacBrowser = fs.readFileSync(path.join(root, 'scripts', 'smoke-packaged-playwright-mac.mjs'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

assert.match(release, /tags: \['v2\.2\.0'\]/, 'only the signed stable tag may auto-publish')
assert.match(release, /unsigned:\s*\n\s+description: Publish a clearly labelled unsigned prerelease/)
assert.match(release, /\^v2\\\.2\\\.0-rc\\\.\[0-9\]\+\$/, 'unsigned releases must be restricted to v2.2.0-rc.N')
assert.match(release, /OPENVZ_RELEASE_BUILD: \$\{\{ inputs\.unsigned && '0' \|\| '1' \}\}/)
assert.match(release, /UNSIGNED-BUILD\.txt/)
assert.match(release, /--prerelease/)
assert.match(release, /prepare-release-version\.mjs/)
assert.match(smoke, /\$RequireSignature = \$env:OPENVZ_RELEASE_BUILD -eq '1'/)
assert.match(smoke, /'NotSigned', 'Valid'/)
assert.match(smoke, /taskkill\.exe \/PID \$app\.Id \/T \/F/, 'Windows upgrade smoke must stop the whole Electron process tree')
assert.match(smoke, /Stop-InstalledProcessTrees \$InstallDir/, 'Windows upgrade smoke must verify no installed child process remains')
assert.match(smoke, /WaitForExit\(\$TimeoutSeconds \* 1000\)/, 'installer operations must have an explicit timeout')
assert.match(release, /Install, launch, upgrade and packaged browser smoke\s+timeout-minutes: 20/, 'Windows smoke step must have a workflow timeout')
assert.ok(versionScript.includes('/^v2\\.2\\.0(?:-rc\\.[0-9]+)?$/'), 'version metadata must accept stable and RC tags only')
assert.match(buildMac, /'--publish', 'never'/, 'native mac jobs must never publish implicitly from a tag')
assert.match(pkg.scripts['build:win'], /--publish never/, 'native Windows jobs must never publish implicitly from a tag')
assert.match(smokeMacBrowser, /maxRetries: 10/, 'macOS browser cleanup must tolerate delayed Chromium filesystem release')
assert.match(smokeMacBrowser, /\['EBUSY', 'ENOTEMPTY'\]/, 'macOS browser cleanup may defer only known transient errors')

console.log('Signed stable and guarded unsigned RC workflow contract: OK')
