#!/usr/bin/env node
// UserPromptSubmit: when a task prompt is large, or touches risky ground (auth, payments,
// data, production, secrets), ask the agent to write a five-line brief before its first
// edit — goal, scope, acceptance, assumptions, risks — so the user can correct it in one line
// before any work is spent.
//
// A trigger, not a toll: small and ordinary requests pass in silence, whatever their wording.
// A vague small request is the deliver skill's job (it loads on "make it faster", "the page is
// broken"); this hook exists for the requests where a wrong guess is expensive. It never holds
// an edit back and never coaches the developer: the brief is the agent's to write.
//
// Two kinds of task get a line naming the cheaper agent to hand them to, when it is installed:
// documentation (the doc-writer, low tier) and a plan of three or more steps to build (the
// implementer, medium tier). A top model does both itself otherwise, at its own price.
//
// Silent for questions, short replies, slash commands and short tasks; a short follow-up right
// after a briefed request refines it and gets no second note. The scoring lives in _prompt.mjs,
// shared with the session-eval rows and the eval-board. Off with `workflow.promptIntake: false`
// in .agents/sdlc.config.json. Never throws; always exits 0.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, readJson, readPayload, logError } from './_config.mjs';
import { intakeFor, routeFor } from './_prompt.mjs';

// The entry point is at the BOTTOM of this file (see learning-signals.mjs for
// the temporal-dead-zone bug that rule prevents).

const GAPS = {
  acceptance: 'how "done" is checked',
  context: 'which files or area it is in',
  scope: 'what is out of scope',
};

function stateFile(sessionId) {
  const dir = join(tmpdir(), 'agent-setup');
  mkdirSync(dir, { recursive: true });
  return join(dir, `prompt-intake-${String(sessionId || 'session').replace(/[^\w-]/g, '')}.json`);
}

/** An agent this project has, in the folder of any agent the kit set up. */
const hasAgent = (root, name) =>
  existsSync(join(root, '.claude', 'agents', `${name}.md`)) || existsSync(join(root, '.agents', 'agents', `${name}.md`)) || existsSync(join(root, '.codex', 'agents', `${name}.toml`));

/** The reviewer to name for risky work: the most specific one this project has. */
function reviewerFor(root, risks) {
  if (risks.some((r) => r !== 'production') && hasAgent(root, 'security-reviewer')) return 'the security-reviewer agent';
  if (hasAgent(root, 'code-reviewer')) return 'the code-reviewer agent';
  return 'a review of your own diff against the brief';
}

const ROUTES = {
  docs: ['doc-writer', 'ROUTE — Do not write these docs yourself: delegate them now to the doc-writer agent, which runs on the low tier and writes docs as well for a fraction of the price. Send it what to document and where it goes, then check the file it writes.'],
  build: ['implementer', 'ROUTE — Do not type this plan out yourself: delegate the steps now to the implementer agent, which runs on the medium tier, one step per call, and review each report — unless you run on the medium tier yourself.'],
};

/** The routing line for a task better done by a cheaper agent this project has, or null. */
function routeLine(root, prompt) {
  const route = ROUTES[routeFor(prompt)];
  return route && hasAgent(root, route[0]) ? route[1] : null;
}

function onPrompt(payload, root, state, seen) {
  const s = { prompts: Number(seen.prompts ?? 0) + 1, lastIntake: Number(seen.lastIntake ?? -99) };
  const need = intakeFor(payload.prompt);
  const refining = need && s.prompts - s.lastIntake <= 2 && need.words < 25 && !need.risks.length;
  const route = routeLine(root, payload.prompt);
  if (!need || refining) {
    writeFileSync(state, `${JSON.stringify(s)}\n`);
    if (route) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `${route} No need to mention this note.` } }));
    return;
  }
  s.lastIntake = s.prompts;
  writeFileSync(state, `${JSON.stringify(s)}\n`);

  const why = need.risks.length ? `It touches ${need.risks.join(', ')}` : 'It is a large request';
  const lines = [
    ...(route ? [route] : []),
    `INTAKE — ${why}. Before your first edit, write it back to the user as a brief, five lines at most:`,
    'Goal · Scope (in / out) · Acceptance (the test, command or visible behaviour that proves it is done) · Assumptions · Risks.',
  ];
  if (need.missing.length) lines.push(`It does not say ${need.missing.map((id) => GAPS[id]).join(', ')}: fill those in from the code, as assumptions.`);
  const deliver = existsSync(join(root, '.agents', 'skills', 'deliver', 'SKILL.md')) ? ' — the deliver skill has the steps' : '';
  lines.push(`Plan before editing, and have ${reviewerFor(root, need.risks)} check the change before you call it done${deliver}. No need to mention this note.`);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') } }));
}

async function run() {
  const payload = await readPayload();
  if (payload.hook_event_name !== 'UserPromptSubmit') return;
  const cfg = loadConfig();
  if (cfg.workflow?.promptIntake === false) return;
  const root = process.env.CLAUDE_PROJECT_DIR || cfg.root;
  const state = stateFile(payload.session_id);
  onPrompt(payload, root, state, readJson(state) ?? {});
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  await run();
} catch (err) {
  logError('prompt-intake', err); // fail open, but leave a trace in `claude --debug`
}
process.exit(0);
