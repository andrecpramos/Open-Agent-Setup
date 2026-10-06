#!/usr/bin/env node
// UserPromptSubmit hook: when the current context window passes a size budget,
// tell the agent once per band (budget, 2 × budget, …) how to keep the rest of
// the work cheap.
//
// Why: every model call re-reads the whole window. A window grown to 900k tokens
// costs about 90k input-token equivalents per call in cache reads alone — the
// largest silent cost in long sessions (see the session-eval rows). The cheap
// levers are the agent's to pull: delegate broad searches to the scout agent,
// read line ranges, and hand off or compact at a natural break. The note costs
// about 90 tokens, once per band.
//
// The size is the last model call's input + cache + output tokens, read from the
// tail of the transcript; a compaction since then resets it. Budget:
// `workflow.contextWarnTokens` in .agents/sdlc.config.json (default 150000,
// 0 = off). Never throws; always exits 0.

import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitContext, loadConfig, readJson, readPayload, logError } from './_config.mjs';

// The entry point is at the BOTTOM of this file (see learning-signals.mjs for
// the temporal-dead-zone bug that rule prevents).

const TAIL_BYTES = 512 * 1024;

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

async function run() {
  const payload = await readPayload();
  if (payload.hook_event_name !== 'UserPromptSubmit') return;
  const budget = Number(loadConfig().workflow?.contextWarnTokens ?? 150000);
  if (!Number.isFinite(budget) || budget <= 0) return;
  const path = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (!path || !existsSync(path)) return;

  const size = contextSize(readTail(path));
  const band = Math.floor(size / budget);
  const dir = join(tmpdir(), 'agent-setup');
  mkdirSync(dir, { recursive: true });
  const state = join(dir, `context-budget-${String(payload.session_id || 'session').replace(/[^\w-]/g, '')}.json`);
  const seen = Number(readJson(state)?.band ?? 0);
  // Below the budget (a fresh or compacted window) resets the bands.
  if (band <= 0) {
    if (seen > 0) writeFileSync(state, '{"band":0}\n');
    return;
  }
  if (band <= seen) return;
  writeFileSync(state, `${JSON.stringify({ band })}\n`);
  emitContext(
    'UserPromptSubmit',
    `CONTEXT BUDGET — this context window is at about ${fmt(size)} tokens, and every model call re-reads all of it.\n` +
      'Finish the current step first. From here: hand broad searches to the scout agent (it returns a map, not\n' +
      'file contents), read line ranges rather than whole files, keep command output short — and when this task\n' +
      'is done or changes direction, run the handoff skill and continue in a fresh session (or /compact with a\n' +
      'focus). No need to comment on this note.',
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
