# OpenVZ Agent 2.2.0 release flow

Public desktop releases are produced only by `.github/workflows/release.yml`.
The workflow builds Windows x64, macOS Intel x64 and macOS Apple Silicon on
native GitHub runners, assembles update metadata once and then publishes a
single GitHub Release. Stable releases are always signed. A manually selected,
clearly labelled unsigned community candidate is permitted only for a
`v2.2.0-rc.N` tag while signing credentials are unavailable.

## Required repository configuration

Apple secrets:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

Azure Trusted Signing secrets:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

Azure repository variables:

- `AZURE_SIGN_PUBLISHER`
- `AZURE_SIGN_ENDPOINT`
- `AZURE_SIGN_CERTIFICATE_PROFILE`
- `AZURE_SIGN_ACCOUNT_NAME`

`npm run verify:release-config` fails a stable release job when any required
value is missing. Formal builds also enable `forceCodeSigning`; an unsigned
installer can never be silently published as `v2.2.0`.

## Unsigned community candidate

When Apple/Azure credentials are unavailable, dispatch **Desktop release** with
an existing `v2.2.0-rc.N` tag and set `unsigned` to `true`. The workflow rejects
all other unsigned tag names. This mode still runs the native install, launch,
upgrade, SQLite, offline Chromium and architecture smoke tests, but does not
claim Authenticode, Developer ID or notarization.

The resulting GitHub Release is a prerelease named **Unsigned Community RC**,
contains `UNSIGNED-BUILD.txt` and SHA-256 checksums, and documents the expected
SmartScreen/Gatekeeper prompts. Do not promote these exact binaries to stable.

## Candidate release

1. Merge the reviewed 2.2.0 pull request after CI passes.
2. Create and push the next unused `v2.2.0-rc.N` tag on the reviewed commit.
3. Let the signed workflow, or the explicitly selected unsigned community RC
   workflow, finish all platform smoke tests.
4. Download the published assets and verify `SHA256SUMS.txt`.
5. Perform real first-run, activation, upgrade and uninstall checks on Windows
   10/11, macOS 12+ Intel and macOS 12+ Apple Silicon.

Expected assets:

- `OpenVZ-Agent-Setup.exe` and blockmap
- `OpenVZ-Agent-mac-x64.dmg` and `.zip`
- `OpenVZ-Agent-mac-arm64.dmg` and `.zip`
- ZIP blockmaps
- `latest.yml` and `latest-mac.yml`
- `SHA256SUMS.txt`
- `UNSIGNED-BUILD.txt` (unsigned community RC only)

## Stable release

After the candidate passes real-machine acceptance, tag the same approved
release commit as `v2.2.0`. Keep `v2.1.439` and the automatic pre-upgrade data
backup available as rollback points.

Local unsigned builds are for development diagnostics only:

```bash
npm ci
npm run build:mac
```

Never upload a locally unsigned artifact as stable or outside the guarded
community RC workflow.
