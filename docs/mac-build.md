# OpenVZ Agent macOS build and release

OpenVZ Agent 2.2.0 targets macOS 12+ on Intel x64 and Apple Silicon arm64.
Electron, the native SQLite module, the speech helper and the bundled
Playwright Chromium must all match the target architecture.

## Development build

Install Node.js 24 and Xcode Command Line Tools, then run:

```bash
npm ci
npm run build:mac
```

`scripts/build-mac.mjs` stages the pinned offline browser, compiles the speech
helper for each target, verifies the installed Electron 43.2.0 native runtime
contract and creates both DMG and ZIP artifacts.

Single-architecture commands are also available:

```bash
npm run build:mac:x64
npm run build:mac:arm64
```

Expected development outputs:

```text
dist/OpenVZ-Agent-mac-x64.dmg
dist/OpenVZ-Agent-mac-x64.zip
dist/OpenVZ-Agent-mac-arm64.dmg
dist/OpenVZ-Agent-mac-arm64.zip
```

## Local validation

After a dual-architecture build:

```bash
node scripts/smoke-mac-artifacts.mjs x64 arm64
node scripts/smoke-packaged-playwright-mac.mjs x64
node scripts/smoke-packaged-playwright-mac.mjs arm64
bash scripts/smoke-mac-launch.sh x64
bash scripts/smoke-mac-launch.sh arm64
```

These checks mount each DMG and verify:

- the app executable and native speech helper architecture;
- the `better-sqlite3` Node-API binary;
- bundled Chromium availability without a runtime download;
- a real browser session and screenshot;
- copied-app launch and `/status` response.

## Signed release

Do not distribute local unsigned artifacts. The GitHub release workflow uses a
Developer ID Application certificate, hardened runtime and App Store Connect
API-key notarization. It signs bundled Chromium helpers before the outer app,
then checks nested signatures, Gatekeeper and the stapled ticket.

Required secrets are documented in `RELEASE.md`. With
`OPENVZ_RELEASE_BUILD=1`, missing credentials or a failed signature stops the
job because `forceCodeSigning` is enabled.

Useful verification commands for a signed installed app are:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/OpenVZ Agent.app"
spctl --assess --type execute --verbose=4 "/Applications/OpenVZ Agent.app"
xcrun stapler validate "/Applications/OpenVZ Agent.app"
```

## User data and logs

Application replacement and user data are intentionally separate:

```text
~/Library/Application Support/OpenVZ Agent
~/Library/Application Support/OpenVZ Agent/logs/openvz-agent.log
```

Do not delete this directory to repair dependencies. It contains conversations,
memory, workflows, MCP configuration and encrypted provider credentials. The
2.2.0 startup migration creates a private versioned backup before changing
configuration or database schema.
