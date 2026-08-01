# macOS remote build quickstart

OpenVZ Agent 2.2.0 supports macOS 12 or newer on both Intel x64 and Apple
Silicon arm64. Formal releases must use the native GitHub runners and signing
workflow described in `RELEASE.md`; this guide is for development builds.

## Prerequisites

- Node.js 24 and npm
- Xcode Command Line Tools
- Git

```bash
node --version
npm --version
xcode-select -p
xcrun --sdk macosx swiftc --version
```

Use a native shell for the machine architecture. Do not mix an x64 Rosetta
Node installation with arm64 dependencies.

## Build

```bash
git clone https://github.com/mrlin728/openvz-agent.git
cd openvz-agent
npm ci
npm run build:mac
```

To build a single architecture:

```bash
npm run build:mac:x64
npm run build:mac:arm64
```

The output directory contains architecture-specific DMG and auto-update ZIP
files:

```text
dist/OpenVZ-Agent-mac-x64.dmg
dist/OpenVZ-Agent-mac-x64.zip
dist/OpenVZ-Agent-mac-arm64.dmg
dist/OpenVZ-Agent-mac-arm64.zip
```

## Verify

```bash
node scripts/smoke-mac-artifacts.mjs x64 arm64
node scripts/smoke-packaged-playwright-mac.mjs x64
node scripts/smoke-packaged-playwright-mac.mjs arm64
bash scripts/smoke-mac-launch.sh x64
bash scripts/smoke-mac-launch.sh arm64
```

The checks validate the app, speech helper, SQLite native module, bundled
offline Chromium, copied-app launch and local `/status` response.

Unsigned local packages may be blocked by Gatekeeper. Public downloads are
required to have a valid Developer ID signature, hardened runtime and stapled
notarization ticket; the release workflow fails if those requirements are not
met.

User data is stored in `~/Library/Application Support/OpenVZ Agent`. Never
delete it as a build troubleshooting step, and never commit `.env`, local API
keys or provider configuration.
