// Tests for the scripts shipped inside skills: the eval scorecard gate and the gate runner.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, makeRepo, tempDir, cleanupTemp, TWO_TRUNK, writeConfig } from './helpers.mjs';
after(cleanupTemp);
const COMPARE = join(ROOT, 'kit', 'developer', 'skills', 'agent-eval', 'scripts', 'compare-scorecards.mjs');
const GATES = join(ROOT, 'kit', 'developer', 'skills', 'gates', 'scripts', 'run-gates.mjs');
// ---------------------------------------------------------------------------
describe('compare-scorecards', () => {
    const dir = tempDir();
    const card = (name, buckets, extra = {}) => {
        const p = join(dir, `${name}.json`);
        writeFileSync(p, JSON.stringify({ suite: 's', candidate: name, runs: 3, buckets, ...extra }));
        return p;
    };
    const compare = (...args) => spawnSync(process.execPath, [COMPARE, ...args], { encoding: 'utf8' });
    const base = card('base', { happy: { passed: 58, total: 60 }, ambiguous: { passed: 15, total: 20 }, adversarial: { passed: 30, total: 30, zeroTolerance: true } });
    test('no regression → exit 0', () => {
        const cand = card('same', { happy: { passed: 59, total: 60 }, ambiguous: { passed: 15, total: 20 }, adversarial: { passed: 30, total: 30 } });
        const r = compare(base, cand);
        assert.equal(r.status, 0, r.stdout);
        assert.match(r.stdout, /no regression/);
    });
    test('a bucket drop beyond tolerance and noise → exit 1, even when overall improves', () => {
        const cand = card('drop', { happy: { passed: 60, total: 60 }, ambiguous: { passed: 8, total: 20 }, adversarial: { passed: 30, total: 30 } });
        const r = compare(base, cand);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /ambiguous/);
    });
    test('a small drop on a small bucket is noise, not a regression; --z 0 restores the plain gate', () => {
        const cand = card('flip', { happy: { passed: 58, total: 60 }, ambiguous: { passed: 13, total: 20 }, adversarial: { passed: 30, total: 30 } });
        const r = compare(base, cand);
        assert.equal(r.status, 0, r.stdout);
        assert.match(r.stdout, /ambiguous.*noise/);
        assert.equal(compare(base, cand, '--z', '0').status, 1);
    });
    test('any failure in a zero-tolerance bucket → exit 1', () => {
        const cand = card('unsafe', { happy: { passed: 60, total: 60 }, ambiguous: { passed: 16, total: 20 }, adversarial: { passed: 29, total: 30 } });
        const r = compare(base, cand);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /zero-tolerance/);
    });
    test('a missing bucket is a regression; tolerance is configurable', () => {
        const cand = card('missing', { happy: { passed: 58, total: 60 }, ambiguous: { passed: 14, total: 20 } });
        assert.equal(compare(base, cand).status, 1);
        const small = card('small-drop', { happy: { passed: 58, total: 60 }, ambiguous: { passed: 14, total: 20 }, adversarial: { passed: 30, total: 30 } });
        assert.equal(compare(base, small, '--z', '0').status, 1);
        assert.equal(compare(base, small, '--z', '0', '--tolerance', '0.06').status, 0);
    });
    test('--json output and malformed input', () => {
        const r = compare(base, base, '--json');
        assert.equal(JSON.parse(r.stdout).regressions.length, 0);
        const bad = join(dir, 'bad.json');
        writeFileSync(bad, '{"buckets": {"x": {"passed": 5, "total": 3}}}');
        assert.equal(compare(base, bad).status, 2);
    });
});
// ---------------------------------------------------------------------------
describe('run-gates', () => {
    const gates = (repo, ...args) => spawnSync(process.execPath, [GATES, ...args], { cwd: repo, encoding: 'utf8' });
    const ok = 'node -e "process.exit(0)"';
    const fail = 'node -e "console.error(\'boom\'); process.exit(1)"';
    test('all blocking gates pass → MERGE-SAFE, exit 0', () => {
        const repo = makeRepo({ config: { ...TWO_TRUNK, gates: [{ id: 'a', command: ok }, { id: 'b', command: ok }] } });
        const r = gates(repo);
        assert.equal(r.status, 0, r.stdout);
        assert.match(r.stdout, /MERGE-SAFE — 2 passed/);
    });
    test('a blocking failure stops the run and shows the fix hint', () => {
        const repo = makeRepo({ config: { ...TWO_TRUNK, gates: [{ id: 'lint', command: fail, fix: 'run the formatter' }, { id: 'test', command: ok }] } });
        const r = gates(repo);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /boom/);
        assert.match(r.stdout, /fix: run the formatter/);
        assert.match(r.stdout, /test: not run/);
        const all = gates(repo, '--continue', '--json');
        const j = JSON.parse(all.stdout);
        assert.equal(j.gates.find((g) => g.id === 'test').status, 'passed');
    });
    test('advisory failures and expectNonZero do not block', () => {
        const repo = makeRepo({
            config: { ...TWO_TRUNK, gates: [{ id: 'audit', command: fail, blocking: false }, { id: 'floor', command: fail, expectNonZero: true }] },
        });
        const r = gates(repo);
        assert.equal(r.status, 0, r.stdout);
        assert.match(r.stdout, /FAIL \(advisory\)/);
        assert.match(r.stdout, /non-zero by design/);
    });
    test('`when` globs scope a gate to the diff; --all overrides', () => {
        const repo = makeRepo({ config: { ...TWO_TRUNK, gates: [{ id: 'api', command: fail, when: ['src/api/**'] }] } });
        const skipped = gates(repo);
        assert.equal(skipped.status, 0, skipped.stdout);
        assert.match(skipped.stdout, /no changed file matches/);
        assert.equal(gates(repo, '--all').status, 1);
    });
    test('no config → exit 2 with guidance; provisional config with no gates → exit 0 with guidance', () => {
        const none = makeRepo();
        const r = gates(none);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /sdlc-init/);
        const prov = makeRepo();
        writeConfig(prov, { ...TWO_TRUNK, _provisional: true, gates: [] });
        const p = gates(prov);
        assert.equal(p.status, 0);
        assert.match(p.stdout, /provisional/);
    });
});
