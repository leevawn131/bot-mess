#!/usr/bin/env node
/**
 * Apply local ws3-fca patch after source files are copied.
 * This keeps Docker builds deterministic because patches are not present
 * during the earlier npm ci layer.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = __dirname;
const patchFile = path.join(rootDir, 'patches', 'ws3-fca+3.5.2.patch');
const targetModule = path.join(rootDir, 'node_modules', 'ws3-fca');

if (!fs.existsSync(targetModule)) {
  console.log('ℹ️ ws3-fca is not installed; skipping patch.');
  process.exit(0);
}

if (!fs.existsSync(patchFile)) {
  console.log('ℹ️ Patch file not found; skipping ws3-fca patch.');
  process.exit(0);
}

const patchCli = path.join(rootDir, 'node_modules', 'patch-package', 'index.js');
if (!fs.existsSync(patchCli)) {
  console.error('❌ patch-package is not installed; cannot apply ws3-fca patch.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [patchCli, '--patch-dir', 'patches'],
  {
    cwd: rootDir,
    stdio: 'inherit',
  },
);

if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status);
}

if (result.error) {
  console.error('❌ Failed to apply ws3-fca patch:', result.error.message);
  process.exit(1);
}

console.log('✅ ws3-fca patch applied.');
