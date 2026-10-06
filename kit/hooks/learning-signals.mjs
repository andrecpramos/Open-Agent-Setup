#!/usr/bin/env node
// The sensing half of the self-improvement loop. One hook, three events:
//
//   SessionStart        — leave the live-session pointer (below). Nothing for the
//                         agent: lessons waiting and retros due are the admin's
//                         to act on, and `agent-setup report` lists them.
//   UserPromptSubmit    — if the user's message reads like a correction or a
//                         standing instruction ("I told you…", "from now on…",
//                         "não faças isso…"), nudge the agent to capture it.
//   PostToolUseFailure  — keep a small, redacted friction log, and when the same
//                         call has failed three times in a session, tell the
//                         agent to stop retrying and diagnose.
//
// Why a hook: a lesson is cheapest to capture at the moment it happens, and the
// moment it happens is exactly when the agent is busiest fixing the mistake.
// A line in AGENTS.md saying "record your lessons" is read at session start and
// forgotten by the first correction.
//
// The hook also leaves a live-session pointer (`.agents/learnings/live-session.json`)
// on every SessionStart: session id plus the transcript path the payload carries.
// `agent-setup eval-board --project` tails that transcript for real tokens, cost,
// model, tool calls and skill activations — no guessing, no extra per-tool hook.
//
// Design rules, same as every hook in this kit: silent unless it has something
// specific to say; never throws; always exits 0; never writes outside
// .agents/learnings/, and only when that directory already exists (so the hook
// is inert in a repo the kit was not installed into).

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPayload, emitContext, repoRoot, learningsDir, logError } from './_config.mjs';
import { isCorrection } from './_transcript.mjs';

// The entry point is at the BOTTOM of this file. With top-level await, code
// placed here would resume before the constants below are initialised, hit the
// temporal dead zone, and — because a hook must fail open — be swallowed
// silently. That happened; the test suite now fails on any stderr output.

async function run() {
  const payload = await readPayload();
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const dir = learningsDir(root);
  if (!existsSync(dir)) return;

  switch (payload.hook_event_name) {
    case 'SessionStart':
      recordLiveSession(root, dir, payload);
      break;
    case 'UserPromptSubmit':
      onPrompt(payload);
      break;
    case 'PostToolUseFailure':
      onFailure(payload, dir);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Live-session pointer for `agent-setup eval-board --project`.
// Silent by design (like the friction log): it is a sensor, not a signal.
// Only what the payload carries is recorded — no transcript is ever read here.
// ---------------------------------------------------------------------------

function recordLiveSession(root, dir, payload) {
  try {
    const transcript = typeof payload.transcript_path === 'string' && payload.transcript_path ? payload.transcript_path : null;
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.env.CLAUDE_PROJECT_DIR ?? null;
    writeFileSync(
      join(dir, 'live-session.json'),
      `${JSON.stringify({ session_id: String(payload.session_id ?? ''), transcript_path: transcript, cwd, started_at: new Date().toISOString() })}\n`,
    );
  } catch {
    // A sensor must never break session start.
  }
}

// ---------------------------------------------------------------------------
// Correction detection lives in _transcript.mjs (isCorrection), shared with the
// session-eval hook, which counts corrections per context window.
// ---------------------------------------------------------------------------

function onPrompt(payload) {
  if (!isCorrection(payload.prompt)) return;

  emitContext(
    'UserPromptSubmit',
    'LEARNING SIGNAL — this message reads like a correction or a standing instruction.\n' +
      'Do what the user asked first. Then, if it teaches something a future session would\n' +
      'otherwise get wrong, add ONE entry to .agents/learnings/inbox.md (format in\n' +
      '.agents/learnings/README.md), once the task is done. If the user said "remember" /\n' +
      '"from now on", mark the entry as a standing rule and follow it for the rest of this\n' +
      'session. No need to comment on this note.',
  );
}

// ---------------------------------------------------------------------------
// Friction log.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /(authorization:\s*(bearer|basic|token)\s+)[^\s"']+/gi,
  /((?:api[_-]?key|token|secret|password|passwd|pwd|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"'&]+/gi,
  /(--?(?:password|token|secret|api-key)[= ])[^\s"']+/gi,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
  /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
];

function redact(text) {
  let out = String(text ?? '');
  for (const rx of SECRET_PATTERNS) {
    out = out.replace(rx, (m, keep) => (typeof keep === 'string' && m.startsWith(keep) ? `${keep}***` : '***'));
  }
  return out;
}

function summarizeInput(tool, input) {
  if (!input || typeof input !== 'object') return '';
  if (typeof input.command === 'string') return input.command;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.notebook_path === 'string') return input.notebook_path;
  if (typeof input.url === 'string') return input.url;
  if (typeof input.pattern === 'string') return `${tool} ${input.pattern}`;
  try {
    return JSON.stringify(input);
  } catch {
    return '';
  }
}

function onFailure(payload, dir) {
  const tool = String(payload.tool_name ?? 'unknown');
  const input = redact(summarizeInput(tool, payload.tool_input)).replace(/\s+/g, ' ').slice(0, 240);
  const errorText = typeof payload.tool_error === 'string' ? payload.tool_error : JSON.stringify(payload.tool_error ?? payload.tool_response ?? '');
  const error = redact(errorText).replace(/\s+/g, ' ').slice(0, 300);
  const session = String(payload.session_id ?? '');
  const key = `${tool}:${input.slice(0, 80)}`;

  const file = join(dir, 'signals.jsonl');
  appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), session, tool, key, input, error })}\n`);

  // Keep the log bounded: it is a sensor, not an archive.
  let lines = [];
  try {
    if (statSync(file).size > 200_000) {
      lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      writeFileSync(file, `${lines.slice(-800).join('\n')}\n`);
    }
  } catch {
    // ignore
  }

  // Three identical failures in one session: the agent is looping.
  try {
    if (!lines.length) lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-60);
    const same = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.session === session && r.key === key).length;
    if (same === 3) {
      emitContext(
        'PostToolUseFailure',
        `FRICTION — this ${tool} call has now failed 3 times in this session (${input.slice(0, 80)}).\n` +
          'Stop retrying variations. Read the error, find the cause (wrong cwd? missing tool? wrong\n' +
          'assumption about the project?), and fix that. Once solved, capture the lesson in\n' +
          '.agents/learnings/inbox.md so the next session does not pay for it again.',
      );
    }
  } catch (err) {
    logError('learning-signals', err);
  }
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  await run();
} catch (err) {
  logError('learning-signals', err); // fail open, but leave a trace in `claude --debug`
}
process.exit(0);
