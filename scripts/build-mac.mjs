#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
const supportedArchs = new Set(['x64', 'arm64']);
const args = process.argv.slice(2).map((arg) => arg.replace(/^--/, ''));
const invalidArgs = args.filter((arg) => !supportedArchs.has(arg));

if (invalidArgs.length > 0) {
  console.error(`[build:mac] unsupported architecture: ${invalidArgs.join(', ')}`);
  console.error('[build:mac] supported architectures: x64, arm64');
  process.exit(1);
}

const requestedArchs = args.filter((arg) => supportedArchs.has(arg));
const archs = requestedArchs.length > 0 ? requestedArchs : ['x64', 'arm64'];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[build:mac] ${command} failed: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['scripts/prebuild-clean.mjs']);
run('node', [
  'scripts/prepare-playwright-browsers.mjs',
  '--platform=darwin',
  ...archs.map((arch) => `--arch=${arch}`),
]);

for (const arch of archs) {
  console.log(`[build:mac] building native macOS speech helper for ${arch}`);
  run('node', ['scripts/build-macos-speech.mjs', arch, '--required']);

  console.log(`[build:mac] verifying better-sqlite3 native binary for ${arch}`);
  run('node', ['scripts/rebuild-native.mjs', `--arch=${arch}`]);

  console.log(`[build:mac] packaging ${arch} DMG and auto-update ZIP`);
  run('node', ['./node_modules/electron-builder/cli.js', '--config', 'electron-builder.config.cjs', '--mac', 'dmg', 'zip', `--${arch}`]);
}
