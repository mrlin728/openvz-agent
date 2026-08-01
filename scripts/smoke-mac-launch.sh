#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:?usage: smoke-mac-launch.sh x64|arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DMG="$ROOT/dist/OpenVZ-Agent-mac-$ARCH.dmg"
SMOKE_ROOT="$(mktemp -d "${RUNNER_TEMP:-/tmp}/openvz-mac-launch.XXXXXX")"
MOUNT="$SMOKE_ROOT/mount"
APPS="$SMOKE_ROOT/Applications"
USER_DIR="$SMOKE_ROOT/user-data"
mkdir -p "$MOUNT" "$APPS" "$USER_DIR"

cleanup() {
  if [[ -n "${APP_PID:-}" ]]; then kill "$APP_PID" 2>/dev/null || true; fi
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$SMOKE_ROOT"
}
trap cleanup EXIT

hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" "$DMG" >/dev/null
ditto "$MOUNT/OpenVZ Agent.app" "$APPS/OpenVZ Agent.app"
xattr -p com.apple.quarantine "$APPS/OpenVZ Agent.app" >/dev/null 2>&1 || true

OPENVZ_USER_DIR="$USER_DIR" OPENVZ_PORT=3721 "$APPS/OpenVZ Agent.app/Contents/MacOS/OpenVZ Agent" >"$SMOKE_ROOT/app.log" 2>&1 &
APP_PID=$!

for _ in $(seq 1 90); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3721/status >/dev/null; then
    test -f "$USER_DIR/data/jarvis.db"
    test -d "$APPS/OpenVZ Agent.app/Contents/Resources/playwright-browsers"
    echo "macOS $ARCH copied-app launch, native SQLite and /status smoke: OK"
    exit 0
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    cat "$SMOKE_ROOT/app.log"
    exit 1
  fi
  sleep 1
done

cat "$SMOKE_ROOT/app.log"
echo "OpenVZ Agent did not expose /status within 90 seconds" >&2
exit 1
