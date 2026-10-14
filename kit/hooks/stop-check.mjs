#!/usr/bin/env node
// Stop hook: before the agent ends its turn, make sure what it changed was
// checked. It reads the current context window from the transcript and blocks
// the stop once when code or config inside the project changed after the last
// passing check, or when the last check after the latest edit failed.
//
// Why a hook: "verify, then claim" is in every project's AGENTS.md, and the
// transcripts show it still gets skipped — code edited after the last test run,
// "tests pass" with no test in sight. An instruction is read at session start;
// this fires at the moment the agent is about to say it is done.
//
// Risky work gets its review the same way. When a task prompt in the window touched auth,
// payments, data, personal data, secrets or production (the same test prompt-intake uses to
// ask for a brief and a review) and code changed, a reviewer agent must have looked at the
// change — the security-reviewer, or the code-reviewer where it is the one installed. A
// model running the session on a cheaper tier read that request at the prompt and skipped it;
// the stop is where it cannot be skipped. The same block carries both asks, so it still costs
// one turn at most.
//
// Once per edit: the block remembers the position of the last edit. When the
// agent stops again without a newer edit (it ran the check, or explained in one
// line why it cannot), the stop goes through. A block costs one turn at most and
// can never loop. Prose, scratch files and agent memory never trigger it (see
// needsCheck in _transcript.mjs); a project's own gate commands count as checks.
// Off with `workflow.verifyBeforeStop: false` in .agents/sdlc.config.json.
//
// Contract with the harness: never throws, always exits 0; the only output is
// the block decision.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateCommands, loadConfig, readJson, readPayload, reviewerFor, logError } from './_config.mjs';
import { intakeFor } from './_prompt.mjs';
import { parseTranscript, windowFacts, windowSlice } from './_transcript.mjs';

const REVIEWERS = new Set(['code-reviewer', 'security-reviewer', 'architecture-reviewer']);
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// The entry point is at the BOTTOM of this file (see learning-signals.mjs for
// the temporal-dead-zone bug that rule prevents).

function stateFile(sessionId) {
  const dir = join(tmpdir(), 'agent-setup');
  mkdirSync(dir, { recursive: true });
  return join(dir, `stop-check-${String(sessionId || 'session').replace(/[^\w-]/g, '')}.json`);
}

async function run() {
  const payload = await readPayload();
  // An early (streaming) Stop run cannot block; only the final one decides.
  if (payload.hook_event_name !== 'Stop' || payload.stop_hook_active === true) return;
  const cfg = loadConfig();
  if (cfg.workflow?.verifyBeforeStop === false) return;
  const path = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (!path || !existsSync(path)) return;

  const root = process.env.CLAUDE_PROJECT_DIR || cfg.root;
  const win = windowSlice(readFileSync(path, 'utf8'));
  const acc = parseTranscript(win.text, String(payload.session_id ?? ''));
  // The reply being finished may not be in the transcript yet; the payload has it.
  if (typeof payload.last_assistant_message === 'string' && payload.last_assistant_message.trim()) {
    acc.lastAssistantText = payload.last_assistant_message;
  }
  const f = windowFacts(acc, { root, checks: gateCommands(cfg) });
  const v = f.verification;
  if (!v.edited) return;
  const checked = v.after_last_edit && v.passed !== false;

  // Risky work: the risks the window's task prompts named, and whether a reviewer looked at the
  // change. Counted from the first edit, so fixing a review's findings does not ask for another.
  const risks = [...new Set(acc.prompts.flatMap((p) => intakeFor(p.text)?.risks ?? []))];
  const reviewer = risks.length ? reviewerFor(root, risks) : null;
  const firstEdit = acc.tools.findIndex((t) => EDITS.has(t.name) && t.done && !t.error);
  const reviewed = acc.tools.slice(firstEdit + 1).some((t) => t.agent && REVIEWERS.has(t.agent) && t.done && !t.denied);
  const review = reviewer && !reviewed ? reviewer : null;
  if (checked && !review) return;

  const state = stateFile(payload.session_id);
  const key = `${win.index}:${v.last_edit}`;
  if (readJson(state)?.key === key) return; // asked once for this edit already
  writeFileSync(state, `${JSON.stringify({ key, at: new Date().toISOString() })}\n`);

  const files = f.files_changed.filter((p) => !/^([a-z]:)?\//i.test(p)).slice(-3).join(', ');
  const how = cfg.gates.length
    ? 'the gates (`node .agents/skills/gates/scripts/run-gates.mjs`, or the gate-runner agent)'
    : "the project's test and lint commands (no gates are configured yet; /sdlc-init adds them)";
  const ask =
    review &&
    `This change touches ${risks.join(', ')} and no reviewer has looked at it: have the ${review} agent review the diff against the brief, and fix or answer its high findings.`;
  const reason = checked
    ? `${ask} If it cannot run here, or you are stopping to ask the user something, say so in one line and stop.`
    : v.passed === false
      ? `The last check after your latest edit failed (${v.commands[v.commands.length - 1]}). Before finishing, fix it, or say plainly that it still fails and why.${ask ? ` ${ask}` : ''}`
      : `Code changed after the last check${files ? ` (${files})` : ''}. Before finishing, run ${how} and report the result` +
        `${f.claims.verified ? ' — your reply claims a verification the transcript does not show' : ''}.${ask ? ` ${ask}` : ''} ` +
        'If nothing can be checked here, or you are stopping to ask the user something, say so in one line and stop.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  await run();
} catch (err) {
  logError('stop-check', err); // fail open, but leave a trace in `claude --debug`
}
process.exit(0);
