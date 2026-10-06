// The delivery workflow and its measurement: the measure-only baseline, delegation in the
// routing runner, the outcome runner (kit against vanilla), the weekly report, and the
// catalog insert `new-skill` uses. Agents are stand-ins (small node scripts): no test here
// spends a real agent run.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runCli, runHook, cleanupTemp, tempDir, ROOT } from './helpers.mjs';
import { activations, verdict, layFixture, resolveScope } from '../lib/routing.mjs';
import { finalText, traceOf, timelineOf, gradePrompt, parseGrade, liftBySkill, loadOutcomeCases } from '../lib/outcomes.mjs';
import { insertCatalogSkill } from '../lib/commands.mjs';
import { nextActions, projectHealth } from '../lib/report.mjs';
import type { ProjectHealth } from '../lib/report.mjs';

after(cleanupTemp);

const read = (p: string): string => readFileSync(p, 'utf8');
const json = (p: string): any => JSON.parse(read(p));

function app(): string {
  const repo = makeRepo({ branch: 'develop', branches: ['develop'] });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
  return repo;
}

/** A window row as session-eval writes it, with what a test cares about. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    session_id: `s-${Math.random()}`,
    window: 0,
    recorded_at: '2026-10-01T10:00:00.000Z',
    prompts: 2,
    corrections: 0,
    tokens: { input: 0, output: 1000, cache_read: 50000, cache_create: 5000, tool_results: 1000 },
    tools: { calls: 4, failed: 0, agents: {} },
    prompt_quality: { tasks: 1, with_acceptance: 1, briefs: 0 },
    verification: { edited: true, after_last_edit: true, passed: true },
    claims: { unverified: false },
    waste: { tokens: 0 },
    heavy: { carried: 0 },
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe('measure-only baseline', () => {
  const env = { AGENT_SETUP_STATE_DIR: tempDir('as-state-') };
  const repo = app();
  writeFileSync(join(repo, 'AGENTS.md'), '# demo\n');
  const r = runCli(['install', repo, '--setup', 'measure'], { env });

  test('installs the recorder and nothing the agent sees', () => {
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /measure-only baseline/);
    assert.equal(read(join(repo, 'AGENTS.md')), '# demo\n', 'no instructions block');
    assert.equal(existsSync(join(repo, 'CLAUDE.md')), false);
    assert.equal(existsSync(join(repo, '.claude', 'skills')), false);
    assert.equal(existsSync(join(repo, '.claude', 'agents')), false);
    assert.equal(existsSync(join(repo, '.agents', 'hooks', 'prompt-intake.mjs')), false);
    assert.ok(existsSync(join(repo, '.agents', 'hooks', 'session-eval.mjs')));
    const s = json(join(repo, '.claude', 'settings.json'));
    assert.deepEqual(Object.keys(s.hooks).sort(), ['PreCompact', 'SessionEnd']);
    assert.equal(s.permissions, undefined, 'no permissions: they would change how the agent works');
    assert.equal(json(join(repo, '.agents', 'agent-setup.json')).selection.mode, 'measure');
    assert.match(read(join(repo, '.gitignore')), /eval-windows\.jsonl/);
  });

  test('status does not ask for the hooks a baseline leaves out', () => {
    const s = runCli(['status', repo], { env });
    assert.doesNotMatch(s.out, /is not wired/);
  });

  test('update --setup full turns the kit on; uninstall removes exactly what was added', () => {
    const u = runCli(['update', repo, '--setup', 'full'], { env });
    assert.equal(u.code, 0, u.out);
    assert.match(u.out, /Run the sdlc-init skill \(\/sdlc-init in Claude Code\)/);
    assert.match(read(join(repo, 'AGENTS.md')), /## How work flows here/);
    assert.ok(existsSync(join(repo, '.claude', 'skills', 'deliver', 'SKILL.md')));
    assert.ok(existsSync(join(repo, '.agents', 'WORKFLOW.md')));
    assert.equal(json(join(repo, '.agents', 'agent-setup.json')).selection.mode, 'full');
    const back = runCli(['update', repo, '--setup', 'measure'], { env });
    assert.equal(back.code, 1);
    assert.match(back.out, /a measure-only baseline is taken before it/);
    const un = runCli(['uninstall', repo], { env });
    assert.equal(un.code, 0, un.out);
    assert.equal(read(join(repo, 'AGENTS.md')), '# demo\n');
    assert.equal(existsSync(join(repo, '.claude', 'skills')), false);
  });

  test('evals compares the baseline windows with the kit windows', () => {
    const p = makeRepo();
    mkdirSync(join(p, '.agents', 'learnings'), { recursive: true });
    const base = Array.from({ length: 3 }, () => row({ setup: { kit: '1.0.0', mode: 'measure' }, verification: { edited: true, after_last_edit: false, passed: null } }));
    const kit = Array.from({ length: 3 }, () => row({ setup: { kit: '1.0.0', mode: 'full' }, tools: { calls: 4, failed: 0, agents: { 'code-reviewer': 1 } }, prompt_quality: { tasks: 1, with_acceptance: 1, briefs: 1 } }));
    writeFileSync(join(p, '.agents', 'learnings', 'eval-windows.jsonl'), `${[...base, ...kit].map((x) => JSON.stringify(x)).join('\n')}\n`);
    const e = runCli(['evals', '--project', p], { env });
    assert.equal(e.code, 0, e.out);
    assert.match(e.out, /Baseline vs kit\s+3 measure-only window\(s\) against 3 with the kit/);
    assert.match(e.out, /code checked after its last edit\s+0%\s+100%\s+better/);
    assert.match(e.out, /fewer than 20 windows on a side/);
    assert.match(e.out, /subagents: code-reviewer 3\s+·\s+briefs 3 for 3 task prompt\(s\)/);
  });
});

// ---------------------------------------------------------------------------
describe('delegation in the routing runner', () => {
  const known = new Set(['deliver', 'security', 'agent:security-reviewer', 'agent:scout']);
  const stream = (blocks: unknown[]): string => `${JSON.stringify({ type: 'assistant', message: { content: blocks } })}\n`;

  test('a Task/Agent call counts as delegating to that agent; the brief it carries is not scanned', () => {
    const out =
      stream([{ type: 'tool_use', name: 'Skill', input: { skill: 'agent-setup:deliver' } }]) +
      stream([{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'agent-setup:security-reviewer', prompt: 'use .claude/skills/security/SKILL.md' } }]);
    assert.deepEqual(activations(out, known), ['deliver', 'agent:security-reviewer']);
  });

  test('need: each entry must activate at some point, a|b accepts either', () => {
    const scope = new Set(['deliver', 'gates', 'agent:gate-runner', 'agent:security-reviewer']);
    assert.equal(verdict({ need: ['agent:security-reviewer'] }, ['deliver', 'agent:security-reviewer'], scope), null);
    assert.match(verdict({ need: ['agent:security-reviewer'] }, ['deliver'], scope)!, /never activated: agent:security-reviewer/);
    assert.equal(verdict({ need: ['agent:gate-runner|gates'] }, ['gates'], scope), null);
    assert.match(verdict({ none: true }, ['agent:gate-runner'], scope)!, /expected no scoped skill/);
    assert.ok(resolveScope(['agent:scout', 'deliver']).has('agent:scout'));
  });

  test("the fixture lands committed on develop, with .pending as the uncommitted diff", () => {
    const dir = tempDir('as-fixture-');
    layFixture(join(ROOT, 'kit', 'developer', 'skills', 'deliver', 'evals', 'fixture'), dir);
    const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'develop');
    assert.match(git('status', '--short'), /M src\/server\.mjs/);
    assert.equal(existsSync(join(dir, '.pending')), false);
    assert.match(read(join(dir, 'src', 'server.mjs')), /DELETE/);
  });

});

// ---------------------------------------------------------------------------
describe('eval-outcomes: the kit against vanilla', () => {
  const dir = tempDir('as-outcomes-');
  const agent = join(dir, 'agent.cjs');
  const grader = join(dir, 'grader.cjs');
  // The stand-in agent loads deliver and writes a brief only where the kit is installed.
  writeFileSync(
    agent,
    [
      'const fs = require("node:fs");',
      'const kit = fs.existsSync(".claude/skills/deliver/SKILL.md");',
      'const ev = (o) => console.log(JSON.stringify(o));',
      'ev({ type: "system", subtype: "init", model: "fake-model" });',
      'if (kit) ev({ type: "assistant", message: { content: [{ type: "tool_use", id: "1", name: "Skill", input: { skill: "deliver" } }] } });',
      'fs.writeFileSync("notes.txt", kit ? "Goal: g\\nAcceptance: a\\n" : "done\\n");',
      'ev({ type: "result", subtype: "success", is_error: false, result: kit ? "Goal: g. Acceptance: a." : "Done." });',
    ].join('\n'),
  );
  // The stand-in grader passes every item for a reply with an Acceptance line, else the first.
  writeFileSync(
    grader,
    [
      'const p = process.argv[2] || "";',
      'const reply = (p.split("<final_reply>")[1] || "").split("</final_reply>")[0];',
      'const n = (p.match(/^\\d+\\. /gm) || []).length;',
      'const results = Array.from({ length: n }, (_, i) => ({ item: i + 1, pass: /Acceptance/.test(reply) || i === 0, evidence: "stand-in" }));',
      'console.log(JSON.stringify({ type: "result", result: JSON.stringify({ results }) }));',
    ].join('\n'),
  );
  const cmd = JSON.stringify([process.execPath, agent, '{prompt}']);
  const graderCmd = JSON.stringify([process.execPath, grader, '{prompt}']);

  test('runs both arms in scratch projects, grades blind, saves kit buckets with vanilla beside them', () => {
    const cards = tempDir('as-cards-');
    const env = { AGENT_SETUP_STATE_DIR: tempDir('as-state-') };
    const r = runCli(['eval-outcomes', '--skill', 'deliver', '--only', '1,3', '--cmd', cmd, '--grader-cmd', graderCmd, '--save', '--scorecards', cards], { env });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 case\(s\) × 2 arm\(s\) × 1 run\(s\) = 4 agent run\(s\)/);
    assert.match(r.out, /deliver\/1\s+kit\s+4\/4\s+vanilla\s+1\/4/);
    assert.match(r.out, /deliver\s+100%\s+25%\s+\+75/);
    const card = json(join(cards, 'outcome.latest.json'));
    assert.deepEqual(card.buckets.deliver, { passed: 8, total: 8, runs: 1, date: card.date });
    assert.equal(card.vanilla.deliver.passed, 2);
    assert.equal(existsSync(join(env.AGENT_SETUP_STATE_DIR, 'projects.json')), false, 'scratch projects are never registered');

    const e = runCli(['evals', '--scorecards', cards], { env });
    assert.match(e.out, /outcome\s+8\s+100%/);
    assert.match(e.out, /outcome: lift over vanilla — deliver \+75/);
  });

  test('only the kit arm is gated: vanilla changing is the model moving, not a regression', () => {
    const cards = tempDir('as-cards-');
    const card = (vanillaPassed: number) => ({ suite: 'outcome', model: 'm', date: '2026-10-01', runs: 3, buckets: { deliver: { passed: 18, total: 20, runs: 3 } }, vanilla: { deliver: { passed: vanillaPassed, total: 20, runs: 3 } } });
    writeFileSync(join(cards, 'outcome.baseline.json'), JSON.stringify(card(4)));
    writeFileSync(join(cards, 'outcome.latest.json'), JSON.stringify(card(17)));
    const e = runCli(['evals', '--scorecards', cards, '--check']);
    assert.equal(e.code, 0, e.out);
    assert.match(e.out, /deliver \+5/);
  });

  test('the pieces: final text, tool trace, a blind grading prompt, a forgiving grade parser, lift', () => {
    const out = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }, { type: 'text', text: 'working' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'security-reviewer' } }] } },
      { type: 'result', result: 'All done.' },
    ]
      .map((x) => JSON.stringify(x))
      .join('\n');
    assert.equal(finalText(out), 'All done.');
    assert.deepEqual(traceOf(out), ['Bash npm test', 'Agent security-reviewer']);
    assert.equal(timelineOf(out), '[does] Bash npm test\n[says] working\n[does] Agent security-reviewer', 'what it said and did, in order');
    const k = loadOutcomeCases('deliver')[0];
    const prompt = gradePrompt(k, 'reply', '', timelineOf(out));
    assert.match(prompt, /1\. Starts with a brief/);
    assert.doesNotMatch(prompt, /vanilla|\bkit\b/i, 'the grader never learns the arm');
    assert.deepEqual(parseGrade('```json\n{"results":[{"item":2,"pass":true}]}\n```', 2)!.map((v) => v.pass), [false, true]);
    assert.equal(parseGrade('I think it passed', 2), null);
    assert.deepEqual(liftBySkill({ buckets: { a: { passed: 9, total: 10, runs: 1, date: '' } }, vanilla: { a: { passed: 6, total: 10, runs: 1, date: '' } } }), [{ skill: 'a', kit: 0.9, vanilla: 0.6, lift: 30 }]);
  });
});

// ---------------------------------------------------------------------------
describe('report: the weekly cycle', () => {
  const health = (over: Partial<ProjectHealth>): ProjectHealth => ({
    name: 'p',
    path: '/p',
    version: '1.0.0',
    mode: 'full',
    outdated: false,
    windows: 30,
    lastWindow: '2026-10-01',
    sinceRetro: 0,
    lastRetro: null,
    inbox: 0,
    universal: 0,
    outbox: 0,
    provisional: false,
    problems: 0,
    ...over,
  });

  test('ranks the actions: broken first, then proposals and retros, then metrics and evals', () => {
    const actions = nextActions(
      [health({ name: 'alpha', outbox: 2, sinceRetro: 25 }), health({ name: 'beta', mode: 'measure', windows: 22 }), health({ name: 'gamma', problems: 1 })],
      [{ suite: 'trigger', accepted: true, trials: 10, passed: 5, baselineTrials: 10, baselinePassed: 5, model: null, date: null, regressions: [], noise: [], warnings: [], incomparable: null, weakest: [{ bucket: 'security/should', passed: 5, total: 10 }] }],
      Array.from({ length: 6 }, () => row({ verification: { edited: true, after_last_edit: false, passed: null } })) as never,
    );
    const whys = actions.map((a) => a.why);
    assert.match(whys[0], /gamma: kit files missing/);
    assert.ok(whys.some((w) => /2 kit proposal\(s\) waiting in alpha/.test(w)));
    assert.ok(whys.some((w) => /alpha: 20\+ windows since the last retro/.test(w)));
    assert.ok(whys.some((w) => /beta: the baseline has 20\+ windows/.test(w)));
    assert.ok(whys.some((w) => /code checked after its last edit: 0% \(target 90%\)/.test(w)));
    assert.ok(whys.some((w) => /trigger: security\/should 5\/10/.test(w)));
    assert.ok(whys.some((w) => /no outcome scorecard yet/.test(w)));
  });

  test('a suite gated by nothing — no baseline, or one measured another way — is an action', () => {
    const suite = { suite: 'routing', accepted: false, trials: 10, passed: 9, baselineTrials: 10, baselinePassed: 10, model: null, date: null, regressions: [], noise: [], warnings: [], incomparable: 'measured with method unstamped, this one with 2', weakest: [] };
    const whys = nextActions([health({ name: 'alpha' })], [suite, { ...suite, suite: 'trigger', incomparable: null, baselineTrials: null, baselinePassed: null }], []).map((a) => a.why);
    assert.ok(whys.some((w) => /routing baseline is not comparable: measured with method unstamped, this one with 2 — nothing gates this suite/.test(w)), whys.join('\n'));
    assert.ok(whys.some((w) => /no baseline for trigger — nothing gates it/.test(w)), whys.join('\n'));
  });

  test('report prints the actions and the projects, and writes Markdown to share', () => {
    const env = { AGENT_SETUP_STATE_DIR: tempDir('as-state-') };
    const repo = app();
    runCli(['install', repo, '--profile', 'minimal'], { env });
    writeFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), `${JSON.stringify(row({ setup: { kit: '1.0.0', mode: 'full' } }))}\n`);
    const r = runCli(['report'], { env });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Next actions/);
    assert.match(r.out, /no verified gates \(sdlc\.config\.json is provisional\)/);
    const md = join(tempDir('as-report-'), 'report.md');
    runCli(['report', '--md', md], { env });
    assert.match(read(md), /^# Agent setup report — \d{4}-\d{2}-\d{2}/);
    assert.match(read(md), /\| Project \| Setup \| Kit \|/);
  });
});

// ---------------------------------------------------------------------------
describe('retro nudge and the catalog insert', () => {
  test("a retro is due after the project's own retroEvery windows — in report, never in a developer's session", () => {
    const repo = app();
    const env = { AGENT_SETUP_STATE_DIR: tempDir('as-state-') };
    runCli(['install', repo, '--profile', 'minimal'], { env });
    const file = join(repo, '.agents', 'learnings', 'eval-windows.jsonl');
    writeFileSync(file, `${Array.from({ length: 3 }, () => JSON.stringify(row({ recorded_at: '2026-10-02T10:00:00.000Z' }))).join('\n')}\n`);
    const cfg = join(repo, '.agents', 'sdlc.config.json');
    writeFileSync(cfg, JSON.stringify({ ...JSON.parse(read(cfg)), workflow: { retroEvery: 3 } }));
    const health = projectHealth(repo);
    assert.equal(health.retroEvery, 3);
    assert.ok(nextActions([health], [], []).some((a) => /3\+ windows since the last retro/.test(a.why)));
    const start = runHook('learning-signals.mjs', { hook_event_name: 'SessionStart', source: 'startup', session_id: 's' }, { cwd: repo });
    assert.equal(start.stdout, '', 'nothing in the session');
    mkdirSync(join(repo, '.agents', 'learnings', 'archive'), { recursive: true });
    const archived = join(repo, '.agents', 'learnings', 'archive', '2026-10.md');
    writeFileSync(archived, '# archive\n');
    utimesSync(archived, new Date('2026-10-03T00:00:00Z'), new Date('2026-10-03T00:00:00Z'));
    assert.equal(nextActions([projectHealth(repo)], [], []).some((a) => /since the last retro/.test(a.why)), false, 'a retro since then resets it');
  });

  test('lessons waiting in an inbox are an action for the admin', () => {
    const delta: ProjectHealth = { name: 'delta', path: '/delta', version: '1.0.0', mode: 'full', outdated: false, windows: 3, lastWindow: null, sinceRetro: 0, lastRetro: null, inbox: 2, universal: 0, outbox: 0, provisional: false, problems: 0 };
    const whys = nextActions([delta], [], []).map((a) => a.why);
    assert.ok(whys.some((w) => /2 lesson\(s\) waiting in the inbox of delta/.test(w)), whys.join('\n'));
  });

  test('new-skill adds one catalog line after its group, keeping the layout', () => {
    const text = read(join(ROOT, 'kit', 'catalog.json'));
    const next = insertCatalogSkill(text, 'release-notes', 'core', 'Write release notes');
    assert.ok(next);
    const added = next.split('\n').filter((l) => !text.split('\n').includes(l));
    assert.deepEqual(added, ['    "release-notes": { "group": "core", "summary": "Write release notes" },']);
    assert.equal(JSON.parse(next).skills['release-notes'].group, 'core');
    assert.equal(insertCatalogSkill('{"skills": {\n    "a": {\n      "group": "core"\n    }\n  }\n}', 'b', 'core', 's'), null, 'an unexpected layout falls back to rewriting');
  });
});

