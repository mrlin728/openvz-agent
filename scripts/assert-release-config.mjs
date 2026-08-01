#!/usr/bin/env node

import fs from 'node:fs'

const platform = process.env.OPENVZ_BUILD_PLATFORM || process.argv.find((arg) => arg.startsWith('--platform='))?.split('=', 2)[1] || process.platform
const release = process.env.OPENVZ_RELEASE_BUILD === '1'

if (!release) {
  console.log('[release-config] development build: signing enforcement is disabled')
  process.exit(0)
}

const common = platform === 'darwin'
  ? ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_TEAM_ID']
  : platform === 'win32'
    ? ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'OPENVZ_AZURE_PUBLISHER', 'OPENVZ_AZURE_ENDPOINT', 'OPENVZ_AZURE_CERTIFICATE_PROFILE', 'OPENVZ_AZURE_ACCOUNT_NAME']
    : []

const missing = common.filter((name) => !String(process.env[name] || '').trim())
if (missing.length) {
  console.error(`[release-config] refusing unsigned release; missing: ${missing.join(', ')}`)
  process.exit(1)
}
if (platform === 'darwin') {
  if (!fs.existsSync(process.env.APPLE_API_KEY)) {
    console.error('[release-config] refusing release; APPLE_API_KEY must point to a readable .p8 file')
    process.exit(1)
  }
  if (!/^[A-Z0-9]{10}$/.test(process.env.APPLE_API_KEY_ID)) {
    console.error('[release-config] refusing release; APPLE_API_KEY_ID format is invalid')
    process.exit(1)
  }
}
if (platform === 'win32' && !/^https:\/\//i.test(process.env.OPENVZ_AZURE_ENDPOINT)) {
  console.error('[release-config] refusing release; Azure Trusted Signing endpoint must use HTTPS')
  process.exit(1)
}
console.log(`[release-config] ${platform} signing configuration is present`)
