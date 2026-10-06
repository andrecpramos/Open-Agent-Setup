// Tests for `agent-setup eval-board`: the offline prompt/run/output graders,
// the combined report, the HTTP board and the --json CLI mode.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scorePrompt,
  improvePrompt,
  scoreRun,
  scoreOutput,
  buildReport,
  evaluatePayload,
  renderPage,
  startEvalBoard,
  parseTranscript,
  loadProject,
  predictSkills,
  judgeRouting,
  estimateCost,
  snapshotLive,
  snapshotAndRecord,
  listRecentSessions,
  recordHistory,
  readHistory,
  historyTrends,
  promoteCase,
} from '../lib/eval-board.mjs';
import type { HistoryEntry, LiveSnapshot } from '../lib/eval-board.mjs';
import { runCli, cleanupTemp, tempDir, ROOT } from './helpers.mjs';

after(cleanupTemp);

// Test fetches go through undici's keep-alive pool like production. Each call
// carries its own 10s abort signal so a genuine stall fails fast with a clear
// error instead of hanging the suite on undici's default timeout.
const apiFetch: typeof fetch = (url, init) =>
  globalThis.fetch(url, { ...init, signal: (init as RequestInit | undefined)?.signal ?? AbortSignal.timeout(10000) });

const STRONG: string = 'Add pagination to `lib/sync.mjs`. Only touch that file, never the tests. Verify with `npm test` and report green.';

// ---------------------------------------------------------------------------
describe('scorePrompt: rubric over the user prompt', () => {
  test('a concrete prompt scores high and names no gaps', () => {
    const r = scorePrompt(STRONG);
    assert.ok(r.score >= 85, JSON.stringify(r));
    assert.deepEqual(r.checks.filter((k) => !k.pass), []);
    assert.equal(r.suggestions.length, 0);
  });

  test('a vague prompt scores low and every gap gets advice', () => {
    const r = scorePrompt('make it better somehow');
    assert.ok(r.score < 30, JSON.stringify(r));
    assert.ok(r.suggestions.length >= 5, r.suggestions.join(' | '));
    assert.match(r.grade, /F/);
  });

  test('an empty prompt explains itself', () => {
    const r = scorePrompt('   ');
    assert.equal(r.score, 0);
    assert.match(r.suggestions[0], /empty/);
  });

  test('improvePrompt keeps the original and scaffolds only the missing parts', () => {
    const improved = improvePrompt('Fix the race in `lib/sync.mjs`.', scorePrompt('Fix the race in `lib/sync.mjs`.'));
    assert.match(improved, /Goal: Fix the race in `lib\/sync\.mjs`\./);
    assert.match(improved, /Acceptance:/);
    assert.match(improved, /Out of scope:/);
    assert.doesNotMatch(improved, /Context:/);
  });
});

// ---------------------------------------------------------------------------
describe('scoreRun: tokens, cost, turns and tool calls', () => {
  test('a tight run is Efficient with a cost baseline note', () => {
    const r = scoreRun({ inputTokens: 1200, outputTokens: 800, costUsd: 0.02, turns: 6, toolCalls: 10, failedCalls: 0, filesChanged: 2 });
    assert.ok(r.score >= 85, JSON.stringify(r));
    assert.equal(r.verdict, 'Efficient');
    assert.equal(r.metrics.totalTokens, 2000);
    assert.ok(Math.abs(r.metrics.costPer1kTokens! - 0.01) < 1e-9);
  });

  test('retries, marathon turns and no files changed all cost points and advice', () => {
    const r = scoreRun({ inputTokens: 40000, outputTokens: 20000, turns: 40, toolCalls: 70, failedCalls: 35, durationMs: 700000, filesChanged: 0 });
    assert.ok(r.score < 65, JSON.stringify(r));
    assert.ok(r.suggestions.some((s) => /failure rate|guessing/i.test(s)));
    assert.ok(r.suggestions.some((s) => /turns/i.test(s)));
    assert.ok(r.suggestions.some((s) => /no changed files/i.test(s)));
    assert.equal(r.metrics.failRate, 0.5);
  });

  test('missing numbers default to zero and never throw', () => {
    const r = scoreRun({});
    assert.equal(r.metrics.totalTokens, 0);
    assert.equal(r.metrics.costUsd, null);
    assert.equal(r.score, 100);
  });
});

// ---------------------------------------------------------------------------
describe('scoreOutput: structure, expectations, hygiene', () => {
  test('empty output scores 0 with a truncation hint', () => {
    const r = scoreOutput('', ['Adds pagination']);
    assert.equal(r.score, 0);
    assert.match(r.suggestions[0], /cut short/i);
  });

  test('a structured, covering output scores high', () => {
    const out = '## Done\n- Added cursor pagination to `lib/sync.mjs` with `--limit` capped at 100 entries per page\n- Updated the sync tests in `tests/cli.test.mjs` with three new pagination cases\n- Ran `npm test`: 42 passed, green across the whole suite';
    const r = scoreOutput(out, ['Adds pagination to the sync listing', 'Updates the tests']);
    assert.ok(r.score >= 85, JSON.stringify(r));
    assert.equal(r.missed.length, 0);
  });

  test('missed expectations are named so they can move into the prompt', () => {
    const r = scoreOutput('## Done\n- Added pagination', ['Adds pagination', 'Migrates the database with zero downtime']);
    assert.deepEqual(r.missed, ['Migrates the database with zero downtime']);
    assert.ok(r.suggestions.some((s) => /Migrates the database/.test(s)));
  });

  test('placeholders are penalised', () => {
    const r = scoreOutput('## Done\n- Added pagination\n- TODO: the rest is left as an exercise\n- Ran tests, green', ['Adds pagination']);
    assert.ok(r.checks.some((k) => k.id === 'hygiene' && !k.pass));
    assert.ok(r.suggestions.some((s) => /placeholder/i.test(s)));
  });
});

// ---------------------------------------------------------------------------
describe('buildReport: the workflow view', () => {
  test('combines the three panels with weights and cross-panel advice', () => {
    const r = buildReport({
      promptText: STRONG,
      run: { inputTokens: 1200, outputTokens: 800, turns: 6, toolCalls: 10, filesChanged: 2 },
      outputText: '## Done\n- Added cursor pagination to `lib/sync.mjs`\n- Ran `npm test`: green across the suite today',
      expectations: ['Adds pagination'],
    });
    assert.equal(r.overall, Math.round(r.prompt.score * 0.3 + r.process.score * 0.35 + r.output.score * 0.35));
    assert.ok(r.workflow.length >= 1);
    assert.ok(r.improvedPrompt.startsWith('Goal:'));
    assert.equal(r.scorecard.suite, 'eval-board');
    assert.equal(r.scorecard.buckets.prompt.passed, r.prompt.score);
  });

  test('a weak prompt with an expensive run says to fix the prompt first', () => {
    const r = buildReport({
      promptText: 'make it better somehow',
      run: { inputTokens: 50000, outputTokens: 20000, turns: 40, toolCalls: 70, failedCalls: 20, filesChanged: 0 },
      outputText: 'did stuff',
      expectations: ['Adds pagination'],
    });
    assert.ok(r.workflow.some((s) => /prompt.*first|cheapest fix/i.test(s)));
  });

  test('evaluatePayload accepts the API shape (prompt/run/output/expectations)', () => {
    const r = evaluatePayload({ prompt: STRONG, run: { turns: 3 }, output: '## Done\n- x', expectations: 'Adds pagination\nUpdates docs' });
    assert.equal(r.output.total, 2);
  });
});

// ---------------------------------------------------------------------------
describe('the board server', () => {
  test('serves the page and evaluates over POST', async () => {
    const { server, url } = await startEvalBoard({ port: 0 });
    try {
      const page = await (await apiFetch(url)).text();
      assert.match(page, /eval-board/);
      assert.doesNotMatch(page, /https?:\/\/(cdn|unpkg|jsdelivr)/, 'no external resources — the board works offline');

      const res = await apiFetch(`${url}api/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: STRONG, run: { turns: 6, toolCalls: 4 }, output: '## Done\n- Added pagination', expectations: ['Adds pagination'] }),
      });
      assert.equal(res.status, 200);
      const report = await res.json();
      assert.ok(report.overall >= 0);
      assert.ok(report.scorecard);

      const bad = await apiFetch(`${url}api/evaluate`, { method: 'POST', body: '{nope' });
      assert.equal(bad.status, 400);
      assert.equal((await apiFetch(`${url}nope`)).status, 404);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test('renderPage is one self-contained file', () => {
    assert.match(renderPage(), /^<!doctype html>/);
  });
});

// ---------------------------------------------------------------------------
describe('eval-board --json (no browser)', () => {
  test('prints the full report as JSON', () => {
    const r = runCli([
      'eval-board', '--json',
      '--prompt', STRONG,
      '--run', '{"inputTokens":1200,"outputTokens":800,"turns":6,"toolCalls":10,"filesChanged":2}',
      '--output', '## Done\n- Added cursor pagination to `lib/sync.mjs`\n- Ran `npm test`: green',
      '--expect', 'Adds pagination,Updates the tests',
    ]);
    assert.equal(r.code, 0, r.out);
    const report = JSON.parse(r.stdout);
    assert.ok(report.overall >= 65, JSON.stringify(report.overall));
    assert.equal(report.scorecard.suite, 'eval-board');
  });

  test('invalid --run JSON is an error, not a silent default', () => {
    const r = runCli(['eval-board', '--json', '--run', '{nope']);
    assert.equal(r.code, 1);
    assert.match(r.out, /valid JSON/);
  });
});

// ---------------------------------------------------------------------------
// Live project mode: transcript fact, not pasted guesses.
// ---------------------------------------------------------------------------

const LIVE_LINES = [
  { type: 'user', message: { role: 'user', content: 'Add pagination to lib/sync.mjs. Only touch that file. Verify with npm test.' }, timestamp: '2026-09-28T10:00:00.000Z', sessionId: 'sess-1', cwd: '/tmp/proj' },
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1000 },
      content: [
        { type: 'thinking', text: 'let me look' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '.agents/skills/backend/SKILL.md' } },
      ],
    },
    timestamp: '2026-09-28T10:00:05.000Z',
    sessionId: 'sess-1',
  },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, timestamp: '2026-09-28T10:00:06.000Z', sessionId: 'sess-1' },
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 100, output_tokens: 2000 },
      content: [
        { type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'agent-setup:backend' } },
        { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'lib/sync.mjs' } },
      ],
    },
    timestamp: '2026-09-28T10:01:00.000Z',
    sessionId: 'sess-1',
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'loaded' }, { type: 'tool_result', tool_use_id: 't3', content: 'no such file', is_error: true }] },
    timestamp: '2026-09-28T10:01:01.000Z',
    sessionId: 'sess-1',
  },
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 50, output_tokens: 400 },
      content: [{ type: 'text', text: '## Done\n- Added cursor pagination to lib/sync.mjs with tests\n- Ran npm test: green across the suite today' }],
    },
    timestamp: '2026-09-28T10:02:00.000Z',
    sessionId: 'sess-1',
  },
  {
    type: 'cost-state',
    sessionId: 'sess-1',
    totalCostUSD: 0.05,
    totalAPIDuration: 90000,
    totalToolDuration: 1200,
    totalDuration: 120000,
    modelUsage: { 'claude-sonnet-5': { inputTokens: 100, outputTokens: 2000, costUSD: 0.05 } },
  },
  { type: 'file-history-snapshot', message: {}, sessionId: 'sess-1' },
];
const LIVE_TEXT: string = LIVE_LINES.map((l) => JSON.stringify(l)).join('\n');

function liveProject(): { dir: string; transcript: string } {
  const dir = tempDir('as-live-');
  mkdirSync(join(dir, '.agents', 'skills', 'backend'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(dir, '.agents', 'overlays'), { recursive: true });
  mkdirSync(join(dir, '.agents', 'learnings'), { recursive: true });
  writeFileSync(join(dir, '.agents', 'agent-setup.json'), JSON.stringify({ kit: { version: '9.9.9' }, selection: { profile: 'standard' } }));
  writeFileSync(join(dir, '.agents', 'skills', 'backend', 'SKILL.md'), '---\nname: backend\ndescription: >\n  Domain logic, persistence and file changes. Use when changing backend files.\n---\n\n# backend\n');
  writeFileSync(join(dir, '.claude', 'agents', 'gate-runner.md'), '---\nname: gate-runner\ndescription: Runs the gates.\n---\n');
  writeFileSync(join(dir, '.agents', 'overlays', 'backend.md'), '# overlay\n');
  const transcript = join(dir, 'sess-1.jsonl');
  writeFileSync(transcript, LIVE_TEXT);
  writeFileSync(join(dir, '.agents', 'learnings', 'live-session.json'), JSON.stringify({ session_id: 'sess-1', transcript_path: transcript, cwd: dir, started_at: '2026-09-28T10:00:00.000Z' }));
  return { dir, transcript };
}

describe('parseTranscript: transcript fact', () => {
  test('counts one prompt, three tool calls, one failure, real tokens and real cost', () => {
    const s = parseTranscript(LIVE_TEXT, 'sess-1');
    assert.equal(s.sessionId, 'sess-1');
    assert.equal(s.prompts.length, 1, 'tool_result-only messages are not prompts');
    assert.deepEqual(s.tools.map((t) => t.name), ['Read', 'Skill', 'Edit']);
    assert.deepEqual(s.tools.map((t) => t.error), [false, false, true]);
    assert.equal(s.inputTokens, 1350);
    assert.equal(s.outputTokens, 2700);
    assert.equal(s.cacheRead, 5000);
    assert.equal(s.costUsd, 0.05, 'cost-state wins over estimates');
    assert.deepEqual(s.skillCalls, ['backend']);
    assert.deepEqual(s.skillDocReads, ['backend']);
    assert.deepEqual(s.filesChanged, [], 'the only edit failed, so no file changed');
    assert.match(s.lastAssistantText, /## Done/);
    assert.ok(!s.lastAssistantText.includes('let me look'), 'thinking blocks are not output');
    assert.equal(s.started, '2026-09-28T10:00:00.000Z');
  });

  test('unknown line types are ignored, empty input parses clean', () => {
    const s = parseTranscript('not json\n{"type":"weird","x":1}\n');
    assert.equal(s.prompts.length, 0);
    assert.equal(s.tools.length, 0);
    assert.equal(s.costUsd, null);
  });
});

describe('loadProject: the setup the session runs in', () => {
  test('reads manifest, skill descriptions, agents and overlays', () => {
    const { dir } = liveProject();
    const p = loadProject(dir);
    assert.equal(p.installed, true);
    assert.equal(p.profile, 'standard');
    assert.equal(p.kitVersion, '9.9.9');
    assert.deepEqual(p.skills.map((s) => s.name), ['backend']);
    assert.match(p.skills[0].description, /Domain logic/);
    assert.deepEqual(p.agents, ['gate-runner']);
    assert.deepEqual(p.overlays, ['backend.md']);
  });

  test('a directory without the kit is reported, not fatal', () => {
    const p = loadProject(tempDir('as-empty-'));
    assert.equal(p.installed, false);
    assert.deepEqual(p.skills, []);
  });
});

describe('routing: heuristic guess vs transcript activation', () => {
  const skills = [
    { name: 'security', description: 'Threat modelling and security review of a change. Use when reviewing code for vulnerabilities.' },
    { name: 'backend', description: 'Domain logic and persistence. Use when changing backend files.' },
  ];

  test('a security prompt predicts the security skill', () => {
    const top = predictSkills('Review this diff for security vulnerabilities before merging', skills);
    assert.equal(top[0].name, 'security');
  });

  test('match and mismatch notes name the real skills', () => {
    const prompt = 'Review this diff for security vulnerabilities before merging';
    assert.equal(judgeRouting(prompt, skills, ['security']).match, true);
    const miss = judgeRouting(prompt, skills, ['backend']);
    assert.equal(miss.match, false);
    assert.match(miss.note, /security/);
    assert.match(miss.note, /backend/);
  });

  test('empty activation says the agent worked without a skill', () => {
    assert.match(judgeRouting('do the thing', skills, []).note, /worked without one/);
  });

  test('model costs are estimated only for known families', () => {
    assert.ok((estimateCost('claude-sonnet-5', 1_000_000, 0) ?? 0) > 0);
    assert.equal(estimateCost('mystery-model-9', 100, 100), null);
  });
});

describe('snapshotLive: one poll of the whole picture', () => {
  test('scores the real session and judges its routing', () => {
    const { dir } = liveProject();
    const live = snapshotLive(dir, { expectations: ['Adds pagination'] });
    assert.equal(live.setup?.installed, true);
    assert.equal(live.sessionId, 'sess-1');
    assert.equal(live.stats?.prompts.length, 1);
    assert.ok((live.prompt?.score ?? 0) > 0);
    assert.equal(live.process?.metrics.turns, 1);
    assert.equal(live.process?.metrics.toolCalls, 3);
    assert.equal(live.process?.metrics.failedCalls, 1);
    assert.equal(live.process?.metrics.filesChanged, 0, 'a failed edit changes nothing');
    assert.equal(live.costUsd, 0.05);
    assert.equal(live.costEstimated, false);
    assert.equal(live.models[0].model, 'claude-sonnet-5');
    assert.equal(live.routing?.match, true, live.routing?.note ?? '');
    assert.equal(live.output?.covered, 1);
    assert.ok((live.overall ?? 0) > 0);
  });

  test('an explicit session id wins over the pointer', () => {
    const { dir } = liveProject();
    const cfg = tempDir('as-config-');
    mkdirSync(join(cfg, 'projects', 'projA'), { recursive: true });
    writeFileSync(join(cfg, 'projects', 'projA', 'other.jsonl'), JSON.stringify({ type: 'user', message: { role: 'user', content: 'Fix the typo in README.' }, sessionId: 'other' }));
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = cfg;
    try {
      const live = snapshotLive(dir, { sessionId: 'other' });
      assert.equal(live.sessionId, 'other');
      assert.equal(live.stats?.prompts.length, 1);
      assert.match(live.stats?.prompts[0].text ?? '', /typo/);
      assert.ok(live.notes.some((n) => /explicit session/.test(n)));
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });

  test('without a pointer the notes say how to get a feed', () => {
    const live = snapshotLive(tempDir('as-nopointer-'));
    assert.equal(live.stats, null);
    assert.ok(live.notes.some((n) => /pointer/.test(n)));
  });
});

describe('live server routes', () => {
  test('/api/live and /api/sessions serve the project feed', async () => {
    const { dir } = liveProject();
    const { server, url } = await startEvalBoard({ port: 0, project: dir });
    try {
      const live = await (await apiFetch(`${url}api/live?session=sess-1`)).json();
      assert.equal(live.sessionId, 'sess-1');
      assert.equal(live.process.metrics.toolCalls, 3);
      const sessions = await (await apiFetch(`${url}api/sessions`)).json();
      assert.equal(sessions.pointer.session_id, 'sess-1');
      assert.ok(Array.isArray(sessions.sessions));
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test('/api/live without a project is a 400, not a silent empty', async () => {
    const { server, url } = await startEvalBoard({ port: 0 });
    try {
      assert.equal((await apiFetch(`${url}api/live`)).status, 400);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test('the page advertises the live card and stays self-contained', async () => {
    const { server, url } = await startEvalBoard({ port: 0, project: tempDir('as-p-') });
    try {
      const page = await (await apiFetch(url)).text();
      assert.match(page, /Live session/);
      assert.doesNotMatch(page, /https?:\/\/(cdn|unpkg|jsdelivr)/);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('eval-board --project --json', () => {
  test('prints the live snapshot for scripts and CI', () => {
    const { dir } = liveProject();
    const r = runCli(['eval-board', '--json', '--project', dir]);
    assert.equal(r.code, 0, r.out);
    const live = JSON.parse(r.stdout);
    assert.equal(live.setup.installed, true);
    assert.equal(live.sessionId, 'sess-1');
    assert.equal(live.costUsd, 0.05);
  });

  test('listRecentSessions reads the config dir override', () => {
    const cfg = tempDir('as-config-');
    mkdirSync(join(cfg, 'projects', 'projA'), { recursive: true });
    writeFileSync(
      join(cfg, 'projects', 'projA', 'sess-9.jsonl'),
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello world' }, sessionId: 'sess-9', cwd: '/x' })}\n${JSON.stringify({ type: 'cost-state', sessionId: 'sess-9', totalCostUSD: 0.01 })}\n`,
    );
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = cfg;
    try {
      const list = listRecentSessions(5);
      assert.equal(list.length, 1);
      assert.equal(list[0].sessionId, 'sess-9');
      assert.equal(list[0].firstPrompt, 'Hello world');
      assert.equal(list[0].costUsd, 0.01);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// The loop: history, trends, promote-to-case.
// ---------------------------------------------------------------------------

describe('recordHistory: one row per session', () => {
  test('upserts idempotently and ignores promptless polls', () => {
    const { dir } = liveProject();
    const first = snapshotLive(dir);
    recordHistory(dir, first);
    recordHistory(dir, snapshotLive(dir));
    assert.equal(readHistory(dir).length, 1, 're-polling never duplicates');
    const row = readHistory(dir)[0];
    assert.equal(row.session_id, 'sess-1');
    assert.equal(row.turns, 1);
    assert.equal(row.cost_usd, 0.05);
    assert.deepEqual(row.activated, ['backend']);
    recordHistory(dir, { ...first, stats: null });
    assert.equal(readHistory(dir).length, 1, 'a poll with no session is not recorded');
  });

  test('keeps the file bounded and skips corrupt rows', () => {
    const { dir } = liveProject();
    const base = snapshotLive(dir);
    assert.ok(base.stats);
    for (let i = 0; i < 205; i++) {
      const stats = { ...base.stats, sessionId: `s-${i}` };
      recordHistory(dir, { ...base, sessionId: `s-${i}`, stats });
    }
    const file = join(dir, '.agents', 'learnings', 'eval-history.jsonl');
    assert.equal(readHistory(dir).length, 200);
    writeFileSync(file, `${readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, 3).join('\n')}\nnot json\n`);
    assert.equal(readHistory(dir).length, 3, 'corrupt rows are skipped');
  });
});

describe('historyTrends: are we getting better', () => {
  const row = (over: Partial<HistoryEntry>): HistoryEntry => ({
    session_id: 'x',
    date: '2026-09-28',
    overall: null,
    prompt: null,
    process: null,
    output: null,
    turns: 1,
    tokens: 100,
    cost_usd: null,
    cost_estimated: false,
    models: [],
    fail_rate: 0,
    files_changed: 0,
    predicted: [],
    activated: [],
    routing_match: null,
    exp_total: 0,
    exp_covered: 0,
    ...over,
  });

  test('averages skip missing values; routing accuracy counts judged sessions', () => {
    const t = historyTrends([
      row({ session_id: 'a', overall: 80, cost_usd: 0.1, fail_rate: 0, predicted: ['backend'], activated: ['backend'], routing_match: true }),
      row({ session_id: 'b', overall: 60, cost_usd: null, fail_rate: 0.5, predicted: ['backend'], activated: ['security'], routing_match: false }),
      row({ session_id: 'c', overall: null }),
    ]);
    assert.equal(t.sessions, 3);
    assert.equal(t.avgOverall, 70);
    assert.equal(t.avgCost, 0.1);
    assert.equal(t.avgFailRate, 0.17);
    assert.equal(t.routingHitRate, 0.5);
    assert.deepEqual(t.perSkill.find((s) => s.skill === 'backend'), { skill: 'backend', predicted: 2, activated: 1, hits: 1 });
    assert.equal(t.recent.length, 3);
  });

  test('empty history is zeros and nulls, not NaN', () => {
    const t = historyTrends([]);
    assert.equal(t.sessions, 0);
    assert.equal(t.avgOverall, null);
    assert.equal(t.routingHitRate, null);
    assert.deepEqual(t.perSkill, []);
  });
});

describe('promoteCase: failures become permanent cases', () => {
  test('an expectation lands in the project corpus only', () => {
    const { dir } = liveProject();
    const r = promoteCase(dir, { sessionId: 'sess-1', kind: 'expectation', text: 'States what was verified', prompt: 'Do the thing' });
    assert.equal(r.paths.length, 1);
    assert.match(readFileSync(r.paths[0], 'utf8'), /States what was verified/);
  });

  test('a routing miss becomes a harvest-ready outbox proposal plus a corpus copy', () => {
    const { dir } = liveProject();
    const r = promoteCase(dir, { sessionId: 'sess-1', kind: 'routing', skill: 'backend', text: 'loads for backend work', prompt: 'Change the backend', evidence: 'loaded security instead' });
    assert.equal(r.paths.length, 2);
    const proposal = readFileSync(r.paths[1], 'utf8');
    assert.match(proposal, /## Evidence/);
    assert.match(proposal, /## Regression case/);
    assert.match(proposal, /trigger\.json/);
    assert.match(proposal, /backend/);
  });

  test('bad input is an error, never a silent file', () => {
    const { dir } = liveProject();
    assert.throws(() => promoteCase(dir, { kind: 'nope', text: 'x' }), /kind/);
    assert.throws(() => promoteCase(dir, { kind: 'routing', text: '   ' }), /text/);
  });
});

describe('loop server routes', () => {
  // One server for the whole loop, like production (one board process): fewer
  // connections churned, fewer chances for localhost TCP stalls under load.
  test('poll, history, promote and headline on one server', async () => {
    const { dir } = liveProject();
    const { server, url } = await startEvalBoard({ port: 0, project: dir });
    const get = (p: string) => apiFetch(`${url}${p}`, { signal: AbortSignal.timeout(10000) });
    try {
      await (await get('api/live?session=sess-1')).json();
      await (await get('api/live?session=sess-1')).json();
      const h = await (await get('api/history')).json();
      assert.equal(h.trends.sessions, 1, 'two polls, one session row');
      assert.equal(h.trends.routingHitRate, 1);
      assert.ok(h.trends.perSkill.some((s: { skill: string }) => s.skill === 'backend'));

      const ok = await apiFetch(`${url}api/case`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-1', kind: 'tool-loop', text: 'retries same bad args', evidence: 'Bash: npm test' }),
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.paths.length, 2);
      const bad = await apiFetch(`${url}api/case`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-1', kind: 'tool-loop', text: 'retries same bad args', evidence: 'Bash: npm test' }),
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(bad.status, 200);

      const snap: LiveSnapshot = await (await get('api/live?session=sess-1')).json();
      assert.ok(snap.nextFix, 'one headline fix');
      assert.match(snap.improvedPrompt ?? '', /^Goal:/);
      const page = await (await get('')).text();
      assert.match(page, /Next fix/);
      assert.match(page, /History/);
      assert.match(page, /Promote/);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test('/api/live and /api/history need a project', async () => {
    const { server, url } = await startEvalBoard({ port: 0 });
    try {
      assert.equal((await apiFetch(`${url}api/live`, { signal: AbortSignal.timeout(10000) })).status, 400);
      assert.equal((await apiFetch(`${url}api/history`, { signal: AbortSignal.timeout(10000) })).status, 400);
      assert.equal((await apiFetch(`${url}api/case`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) })).status, 400);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
