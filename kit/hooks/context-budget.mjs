#!/usr/bin/env node
// The context window's lifecycle: past a size budget, keep the rest of the work cheap, and end
// the window at a natural break instead of dragging it on.
//
//   · UserPromptSubmit — once per band (budget, 2 × budget, …), a note to the agent: delegate
//     broad reading, read line ranges, and leave a handoff when work will outlast the task.
//   · Stop — once per band, a line to the person (a systemMessage: the model never sees it):
//     when this task is done, /clear, after /handoff if the work continues. Silent when the
//     agent's own last message already said so.
//   · SessionStart after /clear — when the window before it left a handoff in the last few
//     hours, point the agent to it, so "continue" picks the work up.
//
// Why: every model call re-reads the whole window. A window grown to 900k tokens costs about
// 90k input-token equivalents per call in cache reads alone — the largest silent cost in long
// sessions (see the session-eval rows) — and an old task's reading left in the window pulls
// the next one off course. The agent cannot clear its own window; the person can, and knows
// when the task is done. The note costs the agent about 90 tokens once per band; the line to
// the person costs it nothing.
//
// The size is the last model call's input + cache + output tokens, read from the tail of the
// transcript; a compaction since then resets it. Budget: `workflow.contextWarnTokens` in
// .agents/sdlc.config.json (default 150000, 0 = off). Never throws; always exits 0.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { emitContext, loadConfig, readJson, readPayload, repoRoot, logError } from './_config.mjs';

// The entry point is at the BOTTOM of this file (see learning-signals.mjs for
// the temporal-dead-zone bug that rule prevents).

const TAIL_BYTES = 512 * 1024;
// A handoff older than this belongs to some earlier work, not to the window just cleared.
const HANDOFF_FRESH_MS = 6 * 60 * 60 * 1000;

/** Tokens in the current window: the last real model call's usage, or 0 after a compaction. */
function contextSize(text) {
  const lines = String(text).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes('"compact_boundary"') && l.includes('"system"')) return 0;
    if (!l.includes('"usage"') || !l.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(l);
      const u = e?.message?.usage;
      if (e?.type !== 'assistant' || !u || e.message.model === '<synthetic>') continue;
      return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
    } catch {
      // a line cut by the tail window, or not JSON
    }
  }
  return 0;
}

function readTail(path) {
  const size = statSync(path).size;
  const n = Math.min(size, TAIL_BYTES);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

/** The newest handoff written in the last few hours: .agents/handoffs/*.md, or the living plan (`docs.plan`). */
function freshHandoff(root, cfg) {
  const candidates = [];
  const dir = join(root, '.agents', 'handoffs');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.md') && f.toLowerCase() !== 'readme.md') candidates.push(join(dir, f));
  }
  if (typeof cfg?.docs?.plan === 'string' && cfg.docs.plan) candidates.push(join(root, cfg.docs.plan));
  let best = null;
  for (const path of candidates) {
    try {
      const at = statSync(path).mtimeMs;
      if (Date.now() - at <= HANDOFF_FRESH_MS && (!best || at > best.at)) best = { path, at };
    } catch {
      // gone between the listing and the stat
    }
  }
  return best;
}

function afterClear(payload) {
  if (payload.source !== 'clear') return;
  const root = repoRoot();
  const h = freshHandoff(root, loadConfig());
  if (!h) return;
  const rel = relative(root, h.path).split('\\').join('/');
  const mins = Math.max(1, Math.round((Date.now() - h.at) / 60000));
  emitContext(
    'SessionStart',
    `HANDOFF — the window before this /clear left \`${rel}\` (written ${mins} min ago). If the person\n` +
      'continues that work, read it first and carry on from its next steps; otherwise ignore it.',
  );
}

async function run() {
  const payload = await readPayload();
  const event = payload.hook_event_name;
  if (event === 'SessionStart') return afterClear(payload);
  if (event !== 'UserPromptSubmit' && event !== 'Stop') return;
  const budget = Number(loadConfig().workflow?.contextWarnTokens ?? 150000);
  if (!Number.isFinite(budget) || budget <= 0) return;
  const path = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (!path || !existsSync(path)) return;

  const size = contextSize(readTail(path));
  const band = Math.floor(size / budget);
  const dir = join(tmpdir(), 'agent-setup');
  mkdirSync(dir, { recursive: true });
  const state = join(dir, `context-budget-${String(payload.session_id || 'session').replace(/[^\w-]/g, '')}.json`);
  // `band` is the agent's note, `stopBand` the person's line: each speaks once per band.
  const was = readJson(state) ?? {};
  const key = event === 'Stop' ? 'stopBand' : 'band';
  const seen = Number(was[key] ?? 0);
  const save = (n) => writeFileSync(state, `${JSON.stringify({ ...was, [key]: n })}\n`);
  // Below the budget (a fresh or compacted window) resets the bands.
  if (band <= 0) {
    if (seen > 0) save(0);
    return;
  }
  if (band <= seen) return;
  save(band);

  if (event === 'Stop') {
    // The agent already advised it in its closing message: one voice is enough.
    if (/\/clear\b/.test(String(payload.last_assistant_message ?? ''))) return;
    emitContext(
      'Stop',
      '',
      `Context: this window is at about ${fmt(size)} tokens, and every message re-reads all of it. When this task is done,\n` +
        '/clear before the next one — a fresh window is cheaper and stays on topic. Work that continues: /handoff first;\n' +
        'the cleared session picks it up.',
    );
    return;
  }
  emitContext(
    'UserPromptSubmit',
    `CONTEXT BUDGET — this context window is at about ${fmt(size)} tokens, and every model call re-reads all of it.\n` +
      'Finish the current step first. From here: hand broad searches to the scout agent (it returns a map, not\n' +
      'file contents), read line ranges rather than whole files, keep command output short. If work will remain\n' +
      'when this task ends, make the handoff (handoff skill) its last step, so the person can /clear and the next\n' +
      'window carries on from it. No need to comment on this note.',
  );
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  await run();
} catch (err) {
  logError('context-budget', err); // fail open, but leave a trace in `claude --debug`
}
process.exit(0);
