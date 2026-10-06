#!/usr/bin/env node
// Compare two eval scorecards bucket by bucket and exit non-zero on a regression.
//
//   node compare-scorecards.mjs <baseline.json> <candidate.json> [--tolerance 0.02] [--z 1.645] [--json]
//
// Exit codes: 0 no regression · 1 regression · 2 unreadable or malformed input.
// A regression is: a bucket whose pass rate drops by more than both the
// tolerance and the sampling noise, a bucket present in the baseline but missing
// from the candidate, or ANY failure in a bucket marked zeroTolerance (in either
// scorecard). Zero dependencies.
//
// The noise band is z × the standard error of the difference between the two
// pass rates (pooled; z = 1.645 is one-sided 95 %). A fixed tolerance alone
// flags noise as regression on small buckets: with 10 cases one flipped case is
// 10 points, and rerunning an unchanged prompt fails a 2-point gate about one
// time in four. `--z 0` restores the plain tolerance gate.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--tolerance', '--z']);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const flagValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number.parseFloat(args[i + 1]) : fallback;
};
const tolerance = flagValue('--tolerance', 0.02);
const z = flagValue('--z', 1.645);
const asJson = args.includes('--json');

/** Standard error of the difference between two pass rates, pooled. */
function noise(b, c) {
  const p = (b.passed + c.passed) / (b.total + c.total);
  return Math.sqrt(p * (1 - p) * (1 / b.total + 1 / c.total));
}

function load(path) {
  try {
    const card = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    if (!card || typeof card.buckets !== 'object') throw new Error('no "buckets" object');
    for (const [name, b] of Object.entries(card.buckets)) {
      if (!Number.isFinite(b?.passed) || !Number.isFinite(b?.total) || b.total <= 0 || b.passed < 0 || b.passed > b.total) {
        throw new Error(`bucket "${name}" needs 0 <= passed <= total and total > 0`);
      }
    }
    return card;
  } catch (err) {
    console.error(`cannot read scorecard ${path}: ${err.message}`);
    process.exit(2);
  }
}

if (positional.length !== 2 || !Number.isFinite(tolerance) || tolerance < 0 || !Number.isFinite(z) || z < 0) {
  console.error('usage: compare-scorecards.mjs <baseline.json> <candidate.json> [--tolerance 0.02] [--z 1.645] [--json]');
  process.exit(2);
}

const base = load(positional[0]);
const cand = load(positional[1]);
const names = [...new Set([...Object.keys(base.buckets), ...Object.keys(cand.buckets)])];
const rows = [];
const regressions = [];
const warnings = [];

for (const name of names) {
  const b = base.buckets[name];
  const c = cand.buckets[name];
  const zero = Boolean(b?.zeroTolerance || c?.zeroTolerance);
  const rate = (x) => (x ? x.passed / x.total : null);
  const br = rate(b);
  const cr = rate(c);
  const band = b && c ? Math.max(tolerance, z * noise(b, c)) : tolerance;
  let verdict = 'ok';
  if (!c) {
    verdict = 'MISSING';
    regressions.push(`${name}: bucket missing from the candidate`);
  } else if (zero && c.passed < c.total) {
    verdict = 'FAIL (zero tolerance)';
    regressions.push(`${name}: ${c.total - c.passed} failure(s) in a zero-tolerance bucket`);
  } else if (br !== null && cr < br - band) {
    verdict = 'REGRESSION';
    regressions.push(`${name}: ${(br * 100).toFixed(1)}% → ${(cr * 100).toFixed(1)}% (allowed drop ${(band * 100).toFixed(1)} pts: tolerance or noise, whichever is larger)`);
  } else if (!b) {
    verdict = 'new';
  } else if (cr > br + band) {
    verdict = 'improved';
  } else if (cr < br - tolerance) {
    verdict = 'noise';
  }
  if (b && c && b.total !== c.total) warnings.push(`${name}: bucket size changed ${b.total} → ${c.total}; the rates are not strictly comparable`);
  rows.push({ bucket: name, baseline: br, candidate: cr, delta: br !== null && cr !== null ? cr - br : null, band, zeroTolerance: zero, verdict });
}

const sum = (card) => Object.values(card.buckets).reduce((a, x) => ({ p: a.p + x.passed, t: a.t + x.total }), { p: 0, t: 0 });
const bo = sum(base);
const co = sum(cand);
const metrics = {};
for (const k of new Set([...Object.keys(base.metrics ?? {}), ...Object.keys(cand.metrics ?? {})])) {
  metrics[k] = { baseline: base.metrics?.[k] ?? null, candidate: cand.metrics?.[k] ?? null };
}
if ((base.runs ?? 1) < 3 || (cand.runs ?? 1) < 3) warnings.push('fewer than 3 runs in at least one scorecard — small deltas are likely noise');

if (asJson) {
  process.stdout.write(`${JSON.stringify({ regressions, warnings, rows, overall: { baseline: bo.p / bo.t, candidate: co.p / co.t }, metrics }, null, 2)}\n`);
} else {
  const pct = (v) => (v === null ? '   —  ' : `${(v * 100).toFixed(1).padStart(5)}%`);
  const d = (v) => (v === null ? '     ' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`);
  console.log(`\n${base.candidate ?? positional[0]}  →  ${cand.candidate ?? positional[1]}\n`);
  console.log(`${'bucket'.padEnd(22)} baseline  candidate   delta  verdict`);
  for (const r of rows) {
    console.log(`${(r.bucket + (r.zeroTolerance ? ' [0]' : '')).padEnd(22)} ${pct(r.baseline)}    ${pct(r.candidate)}  ${d(r.delta).padStart(6)}  ${r.verdict}`);
  }
  console.log(`${'overall'.padEnd(22)} ${pct(bo.p / bo.t)}    ${pct(co.p / co.t)}  ${d(co.p / co.t - bo.p / bo.t).padStart(6)}`);
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${k}: ${v.baseline ?? '—'} → ${v.candidate ?? '—'}`);
  for (const w of warnings) console.log(`warning: ${w}`);
  console.log(regressions.length ? `\nREGRESSION\n${regressions.map((r) => `  - ${r}`).join('\n')}` : '\nno regression');
}
process.exit(regressions.length ? 1 : 0);
