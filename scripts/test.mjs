#!/usr/bin/env node
// Run every tests/*.test.mjs with Node's test runner. `node --test "tests/*.test.mjs"` relies
// on the runner expanding the glob, which arrived in Node 21 — on Node 18 and 20 it finds
// nothing — so the files are listed here. Extra arguments go to the runner
// (e.g. --test-name-pattern="shared tree").

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => join('tests', f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
