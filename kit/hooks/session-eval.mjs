#!/usr/bin/env node
// Records one row of facts for every context window, at no model cost.
//
//   PreCompact  — the window is about to be summarised: record it now, while the
//                 transcript still ends with everything the window did.
//   SessionEnd  — record the last window.
//   SessionStart — with `workflow.sessionSummary: true`, show the person one line of
//                 metrics over the last 20 windows, as a systemMessage the model never
//                 sees. Off by default: the numbers are the admin's, read with
//                 `agent-setup evals` and `report`, not every developer's at every start.
//
// A row holds facts, not a grade: tokens and cache hits per model; token waste
// (a file re-read with no edit in between, the output of failed calls) and heavy
// tool results with what they cost across the later calls that re-read them;
// whether a check ran after the last edit and passed; and whether the final
// message claims a verification the transcript does not show. Judging a row
// against the project's own history is the reader's job (`agent-setup
// eval-board`), so no threshold lives in this hook.
//
// Rows go to .agents/learnings/eval-windows.jsonl (local, gitignored, capped),
// keyed by session and window, so a second run for the same window replaces its
// row. No prompt or command text is stored: file paths, counts, tool names, and
// the name of each check command. The transcript is folded by _transcript.mjs,
// the same parser `agent-setup eval-board` uses.
//
// Design rules, as for every hook in this kit: silent (it never adds to the
// agent's context); never throws; always exits 0; writes only inside
// .agents/learnings/, and only when that directory already exists.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateCommands, loadConfig, learningsDir, readManifest, readPayload, repoRoot, logError } from './_config.mjs';
import { parseTranscript, readRows, summaryLine, summaryTable, windowFacts, windowSlice } from './_transcript.mjs';

// The entry point is at the BOTTOM of this file (see learning-signals.mjs for
// the temporal-dead-zone bug that rule prevents).

const FILE = 'eval-windows.jsonl';
const CAP = 500;

/** `node .agents/hooks/session-eval.mjs --summary [--last N]`: the summary rows, for people and agents. */
function printSummary() {
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const file = join(learningsDir(root), FILE);
  const i = process.argv.indexOf('--last');
  const last = i > 0 && Number(process.argv[i + 1]) > 0 ? Number(process.argv[i + 1]) : 20;
  process.stdout.write(`${summaryTable(existsSync(file) ? readRows(readFileSync(file, 'utf8')) : [], last)}\n`);
}

async function run() {
  // Run by hand: print the table. Checked before reading stdin, which would wait on a terminal.
  if (process.argv.includes('--summary')) return printSummary();
  const payload = await readPayload();
  const event = payload.hook_event_name;
  if (event !== 'PreCompact' && event !== 'SessionEnd' && event !== 'SessionStart') return;
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const dir = learningsDir(root);
  if (!existsSync(dir)) return;
  const cfg = loadConfig();
  // Which setup the window ran under: a measure-only install is the baseline the full kit is compared with.
  const manifest = readManifest(root);
  const setup = { kit: typeof manifest?.kit?.version === 'string' ? manifest.kit.version : null, mode: manifest?.selection?.mode === 'measure' ? 'measure' : 'full' };

  if (event === 'SessionStart') {
    // A compaction continues the same session; the line was shown when it started. A baseline
    // shows nothing: it measures how the team works without the kit, and a metrics line would change that.
    if (payload.source === 'compact' || setup.mode === 'measure' || cfg.workflow?.sessionSummary !== true || !existsSync(join(dir, FILE))) return;
    const line = summaryLine(readRows(readFileSync(join(dir, FILE), 'utf8')));
    if (line) process.stdout.write(JSON.stringify({ systemMessage: `${line}  (table: node .agents/hooks/session-eval.mjs --summary)` }));
    return;
  }

  const path = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (!path || !existsSync(path)) return;
  const win = windowSlice(readFileSync(path, 'utf8'));
  const sessionId = String(payload.session_id ?? '');
  const acc = parseTranscript(win.text, sessionId);
  // A window with no prompt and no tool call (a /clear straight after start) has nothing to record.
  if (!acc.prompts.length && !acc.tools.length) return;

  const end = event === 'PreCompact' ? `compact:${payload.trigger ?? 'auto'}` : `session:${payload.reason ?? 'other'}`;
  const row = {
    v: 1,
    session_id: sessionId || acc.sessionId,
    window: win.index,
    end,
    recorded_at: new Date().toISOString(),
    setup,
    ...windowFacts(acc, { root, checks: gateCommands(cfg) }),
  };
  upsert(join(dir, FILE), row);
}

function upsert(file, row) {
  let lines = [];
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    lines = [];
  }
  const kept = lines.filter((l) => {
    try {
      const r = JSON.parse(l);
      return !(r.session_id === row.session_id && r.window === row.window);
    } catch {
      return false; // drop a corrupt row rather than carry it forever
    }
  });
  kept.push(JSON.stringify(row));
  writeFileSync(file, `${kept.slice(-CAP).join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  await run();
} catch (err) {
  logError('session-eval', err); // fail open, but leave a trace in `claude --debug`
}
process.exit(0);
