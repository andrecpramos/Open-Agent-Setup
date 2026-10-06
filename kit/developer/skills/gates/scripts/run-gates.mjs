#!/usr/bin/env node
// Run this repo's gates exactly as CI does, cheapest first, from .agents/sdlc.config.json.
//
//   node .agents/skills/gates/scripts/run-gates.mjs [--all] [--only a,b] [--skip a,b] [--continue] [--json]
//
//   (default)   run gates in order; a gate with `when` globs runs only if the working diff
//               touches a matching path; stop at the first failing BLOCKING gate.
//   --all       ignore `when` — run every gate.
//   --continue  keep going after a blocking failure (full picture, slower).
//   --only/--skip  select gates by id.
//   --json      machine-readable result on stdout.
//
// Exit: 0 every blocking gate passed · 1 a blocking gate failed · 2 no usable config.
//
// Self-contained on purpose (no import from .agents/hooks): Claude Code runs it through
// its .claude/skills link, where relative paths into the hooks folder would break.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const list = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
};

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const root = git('rev-parse', '--show-toplevel') ?? process.cwd();
const cfgPath = ['.agents', '.claude', '.ai'].map((d) => join(root, d, 'sdlc.config.json')).find(existsSync);
let cfg = null;
try {
  cfg = cfgPath ? JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '')) : null;
} catch (err) {
  console.error(`sdlc.config.json is not valid JSON: ${err.message}`);
  process.exit(2);
}
if (!cfg) {
  console.error('No .agents/sdlc.config.json — there is no gate list to run. Run /sdlc-init (or the sdlc-init skill) to create one.');
  process.exit(2);
}
const gates = Array.isArray(cfg.gates) ? cfg.gates : [];
if (!gates.length) {
  const msg = cfg._provisional
    ? 'The sdlc config is provisional and has no gates yet. Run /sdlc-init to record the gates CI actually runs.'
    : 'The sdlc config lists no gates.';
  if (flag('--json')) process.stdout.write(`${JSON.stringify({ ok: true, gates: [], note: msg })}\n`);
  else console.log(msg);
  process.exit(0);
}

// --- Which files does the working diff touch? --------------------------------
function changedFiles() {
  const b = cfg.branching ?? {};
  const base = b.model === 'trunk' || !b.integration ? b.production ?? 'main' : b.integration;
  const mergeBase = git('merge-base', 'HEAD', base) ?? git('merge-base', 'HEAD', `origin/${base}`);
  const sets = [
    mergeBase ? git('diff', '--name-only', `${mergeBase}...HEAD`) : null,
    git('diff', '--name-only'),
    git('diff', '--name-only', '--cached'),
    git('ls-files', '--others', '--exclude-standard'),
  ];
  return [...new Set(sets.filter(Boolean).flatMap((s) => s.split(/\r?\n/)).filter(Boolean))];
}

function matchGlob(pattern, path) {
  const src = String(pattern).replace(/\\/g, '/');
  let rx = '';
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '*') {
      if (src[i + 1] === '*') {
        if (src[i + 2] === '/') {
          rx += '(?:.*/)?';
          i += 2;
        } else {
          rx += '.*';
          i += 1;
        }
      } else rx += '[^/]*';
    } else if (c === '?') rx += '[^/]';
    else if (c === '{') {
      depth++;
      rx += '(?:';
    } else if (c === '}' && depth) {
      depth--;
      rx += ')';
    } else if (c === ',' && depth) rx += '|';
    else if ('.+^$()|[]\\{}'.includes(c)) rx += `\\${c}`;
    else rx += c;
  }
  try {
    return new RegExp(`^${rx}$`).test(String(path).replace(/\\/g, '/'));
  } catch {
    return false;
  }
}

const only = list('--only');
const skip = list('--skip');
const all = flag('--all');
const cont = flag('--continue');
const asJson = flag('--json');
const changed = gates.some((g) => Array.isArray(g.when) && g.when.length) && !all ? changedFiles() : [];

const results = [];
let blockingFailed = false;

for (const gate of gates) {
  const id = gate.id ?? '(no id)';
  if (only.length && !only.includes(id)) continue;
  if (skip.includes(id)) {
    results.push({ id, status: 'skipped', reason: '--skip' });
    continue;
  }
  if (!all && Array.isArray(gate.when) && gate.when.length && !changed.some((f) => gate.when.some((p) => matchGlob(p, f)))) {
    results.push({ id, status: 'skipped', reason: 'no changed file matches `when`' });
    continue;
  }
  if (blockingFailed && !cont) {
    results.push({ id, status: 'not run', reason: 'an earlier blocking gate failed' });
    continue;
  }

  if (!asJson) process.stdout.write(`▶ ${id}${gate.title ? ` — ${gate.title}` : ''}\n  $ ${gate.command}\n`);
  const started = Date.now();
  const r = spawnSync(gate.command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: gate.timeoutMs ?? 15 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const ms = Date.now() - started;
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
  const blocking = gate.blocking !== false;
  let status;
  if (timedOut) status = 'failed';
  else if (r.error) status = 'failed';
  else if (r.status === 0) status = 'passed';
  else if (gate.expectNonZero) status = 'ran';
  else status = 'failed';
  if (status === 'failed' && blocking) blockingFailed = true;

  const tail = output.trim().split(/\r?\n/).slice(-40).join('\n');
  results.push({
    id,
    status,
    blocking,
    exitCode: r.status,
    ms,
    ...(timedOut ? { reason: `timed out after ${gate.timeoutMs ?? 900000} ms — inconclusive gates fail closed` } : {}),
    ...(r.error && !timedOut ? { reason: r.error.message } : {}),
    ...(status === 'failed' ? { output: tail, fix: gate.fix } : {}),
  });
  if (!asJson) {
    const label = status === 'passed' ? 'PASS' : status === 'ran' ? `RAN (exit ${r.status}, non-zero by design)` : blocking ? 'FAIL' : 'FAIL (advisory)';
    process.stdout.write(`  ${label} in ${(ms / 1000).toFixed(1)}s\n`);
    if (status === 'failed') {
      process.stdout.write(`${tail.replace(/^/gm, '    │ ')}\n`);
      if (gate.fix) process.stdout.write(`  fix: ${gate.fix}\n`);
    }
    process.stdout.write('\n');
  }
}

const summary = {
  ok: !blockingFailed,
  passed: results.filter((r) => r.status === 'passed').length,
  failed: results.filter((r) => r.status === 'failed').length,
  skipped: results.filter((r) => r.status === 'skipped' || r.status === 'not run').length,
  provisional: cfg._provisional === true,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify({ ...summary, gates: results }, null, 2)}\n`);
} else {
  console.log(`${summary.ok ? 'MERGE-SAFE' : 'BLOCKED'} — ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped${summary.provisional ? ' (config is PROVISIONAL — gates unverified)' : ''}`);
  for (const r of results.filter((x) => x.status === 'skipped' || x.status === 'not run')) console.log(`  · ${r.id}: ${r.status} — ${r.reason}`);
}
process.exit(summary.ok ? 0 : 1);
