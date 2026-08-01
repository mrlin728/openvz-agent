const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout || ''
}

function signingIdentity() {
  if (process.env.MAC_CSC_NAME) return process.env.MAC_CSC_NAME
  if (process.env.CSC_NAME) return process.env.CSC_NAME
  const output = run('security', ['find-identity', '-v', '-p', 'codesigning'])
  const match = output.match(/"(Developer ID Application:[^"]+)"/)
  if (!match) throw new Error('Developer ID Application identity was not found after certificate import')
  return match[1]
}

function walk(root, out = []) {
  if (!fs.existsSync(root)) return out
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) walk(file, out)
    else if (entry.isFile()) out.push(file)
  }
  return out
}

function isMachO(file) {
  try { return /Mach-O/.test(run('file', ['-b', file])) } catch { return false }
}

module.exports = async function signBundledBinaries(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.OPENVZ_RELEASE_BUILD !== '1') return
  const identity = signingIdentity()
  const appName = `${context.packager.appInfo.productFilename}.app`
  const resources = path.join(context.appOutDir, appName, 'Contents', 'Resources')
  const browserRoot = path.join(resources, 'playwright-browsers')
  const entitlements = path.resolve(__dirname, '..', 'build', 'entitlements.mac.inherit.plist')
  const binaries = walk(browserRoot).filter(isMachO).sort((a, b) => b.length - a.length)

  if (binaries.length === 0) throw new Error(`No bundled Playwright Chromium Mach-O files found under ${browserRoot}`)
  for (const binary of binaries) {
    run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', entitlements, '--sign', identity, binary])
  }

  const bundles = []
  const collectBundles = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      collectBundles(full)
      if (/\.(app|framework|xpc)$/i.test(entry.name)) bundles.push(full)
    }
  }
  collectBundles(browserRoot)
  for (const bundle of bundles.sort((a, b) => b.length - a.length)) {
    run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--entitlements', entitlements, '--sign', identity, bundle])
  }
  console.log(`[sign] signed ${binaries.length} bundled Chromium binaries and ${bundles.length} nested bundles`)
}
