#!/usr/bin/env node
// Build the CLI: strict typecheck + emit src/**/*.mts with tsc into a staging
// dir, then copy the outputs over the committed lib/*.mjs and bin/*.mjs.
//
// Staging keeps tsc's outDir out of the source tree (tsc excludes its outDir
// from inputs, so it cannot emit in place). Only files with a src/ source are
// overwritten; hand-written lib/*.mjs not yet migrated are left alone.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, '.build-ts');
const TSC = join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');

function fail(msg) {
  process.stderr.write(`build: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(TSC)) fail('typescript is not installed — run `npm install` first.');

const tsc = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'inherit' });
if (tsc.status !== 0) fail('tsc reported errors.');

for (const dir of ['lib', 'bin', 'tests']) {
  const from = join(STAGE, dir);
  if (!existsSync(from)) continue;
  mkdirSync(join(ROOT, dir), { recursive: true });
  cpSync(from, join(ROOT, dir), { recursive: true });
}
rmSync(STAGE, { recursive: true, force: true });
