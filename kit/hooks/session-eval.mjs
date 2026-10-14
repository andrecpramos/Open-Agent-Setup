#!/usr/bin/env node
// Records one row of facts for every context window, at no model cost.
//
//   PreCompact  — the window is about to be summarised: record it now, while the
//                 transcript still ends with everything the window did.
//   SessionEnd  — record the last window.
//   SessionStart — with `workflow.sessionSummary: true`, show the person one line of
//                 metrics and one of cost over the last 20 windows, as a systemMessage
//                 the model never sees. Off by default: the numbers are the admin's, read
//                 with `agent-setup evals`, `usage` and `report`, not every developer's at
//                 every start.
//
// Run by hand, `--summary` prints the metrics table and `--usage` what the windows cost
// and what routing work across the model tiers saved, priced with .agents/models.json
// (_usage.mjs, shared with `agent-setup usage`).
//
// A row holds facts, not a grade: tokens and cache hits per model, the main thread's
// and, under agents_usage, each subagent run's (read from its own transcript); token waste
// (a file re-read with no edit in between, the output of failed calls) and heavy
// tool results with what they cost across the later calls that re-read them;
// whether a check ran after the last edit and passed; and whether the final
// message claims a verification the transcript does not show. Judging a row
// against the project's own history is the reader's job (`agent-setup
// evals`), so no threshold lives in this hook.
//
// Rows go to .agents/learnings/eval-windows.jsonl (local, gitignored, capped),
// keyed by session and window, so a second run for the same window replaces its
// row. No prompt or command text is stored: file paths, counts, tool names, and
// the name of each check command. The transcript is folded by _transcript.mjs,
// the same parser `agent-setup usage` uses.
//
// Design rules, as for every hook in this kit: silent (it never adds to the
// agent's context); never throws; always exits 0; writes only inside
// .agents/learnings/, and only when that directory already exists.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateCommands, loadConfig, learningsDir, readManifest, readPayload, repoRoot, logError } from './_config.mjs';
import { parseTranscript, readRows, summaryLine, summaryTable, windowFacts, windowSlice } from './_transcript.mjs';
import { projectModels, subagentUsage, usageLine, usageReport, usageText } from './_usage.mjs';

// The entry point is at the BOTTOM of this file (see learning-signals.mjs for
// the temporal-dead-zone bug that rule prevents).

const FILE = 'eval-windows.jsonl';
const CAP = 500;

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const projectRows = (root) => {
  const file = join(learningsDir(root), FILE);
  return existsSync(file) ? readRows(readFileSync(file, 'utf8')) : [];
};

/** `node .agents/hooks/session-eval.mjs --summary [--last N]`: the summary rows, for people and agents. */
function printSummary() {
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const last = Number(argOf('--last')) > 0 ? Number(argOf('--last')) : 20;
  process.stdout.write(`${summaryTable(projectRows(root), last)}\n`);
}

/** `node .agents/hooks/session-eval.mjs --usage [--last N] [--vs main|<tier>|<model>]`: cost, routing and quality. */
function printUsage() {
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const last = Number(argOf('--last')) > 0 ? Number(argOf('--last')) : 0;
  const rows = projectRows(root);
  const report = usageReport(last ? rows.slice(-last) : rows, projectModels(root, loadConfig()), { reference: argOf('--vs') });
  process.stdout.write(`${usageText(report)}\n`);
}

async function run() {
  // Run by hand: print a table. Checked before reading stdin, which would wait on a terminal.
  if (process.argv.includes('--summary')) return printSummary();
  if (process.argv.includes('--usage')) return printUsage();
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
    const rows = projectRows(root);
    const line = summaryLine(rows);
    const cost = usageLine(usageReport(rows.slice(-20), projectModels(root, cfg)));
    if (line) process.stdout.write(JSON.stringify({ systemMessage: `${line}${cost ? `\n${cost}` : ''}  (tables: node .agents/hooks/session-eval.mjs --summary, --usage)` }));
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
  // What the window's subagents used, from their own transcripts (a run still going counts what it has done).
  const agents = subagentUsage(path, acc.subagentRuns);
  if (Object.keys(agents).length) row.agents_usage = agents;
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
