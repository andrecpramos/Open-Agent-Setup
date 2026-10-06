#!/usr/bin/env node
// The kit's hooks for agents other than Claude Code. Every agent with a hook API calls this
// one entry point, which translates the agent's payload into the one the kit's hooks speak
// (Claude Code's — Codex speaks it too), runs the hook unchanged, and translates its answer
// back into what that agent understands. One copy of every rule; the agents differ only here.
//
//   node .agents/hooks/run-hook.mjs <agent> <hook>
//
//   agent  codex · cursor · copilot · antigravity · windsurf
//   hook   guard-git      before a shell command: deny the ones the branching contract forbids
//          check-gates    after a file edit: run the fast check that edit could break
//          branch-check   at session start: speak only when the branch needs attention
//          prompt-intake  on a prompt: ask for a brief when the request is large or risky
//          learning-signals  on a prompt: note a correction for the learnings inbox
//
// What each agent can do differs (docs/ARCHITECTURE.md, "Which agents get what"): the
// installer wires a hook only where the agent has an event for it. The hooks that read
// Claude Code's own session transcript — stop-check, session-eval, context-budget — are not
// translated: every agent writes its transcript differently.
//
// Fails open like every hook: an unknown agent or hook, an unreadable payload or a broken
// hook lets the action through, and the error goes to stderr (the agents' debug logs).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The Claude Code event each kit hook expects.
const EVENTS = {
  'guard-git': 'PreToolUse',
  'check-gates': 'PostToolUse',
  'branch-check': 'SessionStart',
  'prompt-intake': 'UserPromptSubmit',
  'learning-signals': 'UserPromptSubmit',
};
const AGENTS = new Set(['codex', 'cursor', 'copilot', 'antigravity', 'windsurf']);

// The entry point is at the BOTTOM of this file (see learning-signals.mjs for the
// temporal-dead-zone bug that rule prevents).

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Copilot sends tool arguments as an object, or as a JSON string. */
function argsOf(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** The files a Codex apply_patch touches: its "*** Update File:", "Add File:" and "Move to:" lines. */
function patchFiles(patch) {
  return [...String(patch ?? '').matchAll(/^\*\*\* (?:Update File|Add File|Move to): (.+)$/gm)].map((m) => m[1].trim());
}

const firstOf = (list) => (Array.isArray(list) && typeof list[0] === 'string' ? list[0] : undefined);

/** The project the agent is working in. */
function projectRoot(payload) {
  for (const v of [process.env.CURSOR_PROJECT_DIR, process.env.CLAUDE_PROJECT_DIR]) if (v) return v;
  const cwd = payload.cwd ?? firstOf(payload.workspace_roots) ?? firstOf(payload.workspacePaths) ?? payload.tool_info?.cwd ?? process.cwd();
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd;
  } catch {
    return cwd;
  }
}

/**
 * The payloads to give the kit hook (Claude Code's shape), or [] when this call is not one the
 * hook acts on — a tool that is not a shell command, an edit with no file. One per edited file.
 */
function translateInput(agent, hook, p) {
  const base = {
    hook_event_name: EVENTS[hook],
    session_id: String(p.session_id ?? p.sessionId ?? p.conversation_id ?? p.conversationId ?? p.trajectory_id ?? ''),
    cwd: p.cwd ?? firstOf(p.workspace_roots) ?? firstOf(p.workspacePaths) ?? p.tool_info?.cwd,
  };
  switch (hook) {
    case 'guard-git': {
      let command = '';
      let tool = 'Bash';
      if (agent === 'copilot') {
        const name = String(p.toolName ?? p.tool_name ?? '').toLowerCase();
        if (name !== 'bash' && name !== 'powershell' && name !== 'shell') return [];
        if (name === 'powershell') tool = 'PowerShell';
        command = argsOf(p.toolArgs ?? p.tool_input).command ?? '';
      } else if (agent === 'windsurf') {
        command = p.tool_info?.command_line ?? '';
      } else if (agent === 'antigravity') {
        if (String(p.toolCall?.name ?? '') !== 'run_command') return [];
        const a = argsOf(p.toolCall?.args);
        command = a.CommandLine ?? a.commandLine ?? a.command ?? a.command_line ?? '';
      } else if (agent === 'cursor') {
        command = p.command ?? p.tool_input?.command ?? '';
      } else {
        // codex: Bash, Claude Code's shape
        command = p.tool_input?.command ?? '';
      }
      return command ? [{ ...base, tool_name: tool, tool_input: { command: String(command) } }] : [];
    }
    case 'check-gates': {
      let files = [];
      if (agent === 'codex') files = patchFiles(p.tool_input?.command ?? p.tool_input?.input);
      else if (agent === 'copilot') {
        const name = String(p.toolName ?? p.tool_name ?? '').toLowerCase();
        if (!['edit', 'create', 'write'].includes(name)) return [];
        const a = argsOf(p.toolArgs ?? p.tool_input);
        files = [a.path ?? a.file_path ?? a.filePath].filter(Boolean);
      } else files = [p.tool_input?.file_path ?? p.tool_input?.path ?? p.file_path ?? p.tool_info?.file_path].filter(Boolean);
      return files.map((f) => ({ ...base, tool_name: 'Edit', tool_input: { file_path: String(f) } }));
    }
    case 'branch-check': {
      const source = { new: 'startup' }[p.source] ?? p.source ?? 'startup';
      return [{ ...base, source }];
    }
    default: {
      const prompt = p.prompt ?? p.tool_info?.user_prompt;
      return typeof prompt === 'string' && prompt ? [{ ...base, prompt }] : [];
    }
  }
}

/** Run one kit hook with a Claude Code payload; its parsed answer, or null. */
function runKitHook(hook, payload, root) {
  const r = spawnSync(process.execPath, [join(here, `${hook}.mjs`)], {
    input: JSON.stringify(payload),
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    timeout: 25_000,
    windowsHide: true,
  });
  if (r.stderr) process.stderr.write(r.stderr);
  try {
    return r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {
    return null;
  }
}

/** Fold the kit hooks' answers into one: a denial wins; notes are joined. */
function combine(answers) {
  const out = { deny: null, context: [], userMessage: [] };
  for (const a of answers) {
    if (!a) continue;
    const h = a.hookSpecificOutput ?? {};
    if (h.permissionDecision === 'deny' && !out.deny) out.deny = String(h.permissionDecisionReason ?? 'Denied by the agent-setup guard.');
    if (h.additionalContext) out.context.push(String(h.additionalContext));
    if (a.systemMessage) out.userMessage.push(String(a.systemMessage));
  }
  return { deny: out.deny, context: out.context.join('\n\n'), userMessage: out.userMessage.join('\n') };
}

/**
 * The answer in the agent's own words: { stdout, stderr, code }. Nothing to say → empty stdout,
 * exit 0, which every agent reads as "go ahead".
 */
function translateOutput(agent, hook, { deny, context, userMessage }) {
  const json = (o) => ({ stdout: `${JSON.stringify(o)}\n`, stderr: '', code: 0 });
  const quiet = { stdout: '', stderr: '', code: 0 };
  const event = EVENTS[hook];
  if (deny) {
    switch (agent) {
      case 'codex':
        return json({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: deny } });
      case 'cursor':
        return json({ permission: 'deny', user_message: deny, agent_message: deny });
      case 'copilot':
        return json({ permissionDecision: 'deny', permissionDecisionReason: deny });
      case 'antigravity':
        return json({ decision: 'deny', reason: deny });
      case 'windsurf':
        return { stdout: '', stderr: `${deny}\n`, code: 2 };
      default:
        return quiet;
    }
  }
  if (!context && !userMessage) return quiet;
  switch (agent) {
    case 'codex':
      return json({ ...(context ? { hookSpecificOutput: { hookEventName: event, additionalContext: context } } : {}), ...(userMessage ? { systemMessage: userMessage } : {}) });
    case 'cursor':
      // sessionStart and postToolUse take additional_context; there is no message to the person.
      return context ? json({ additional_context: context }) : quiet;
    case 'copilot':
      return context ? json({ additionalContext: context }) : quiet;
    default:
      return quiet;
  }
}

function main() {
  const [agent, hook] = process.argv.slice(2);
  if (!AGENTS.has(agent) || !EVENTS[hook]) {
    process.stderr.write(`[agent-setup:run-hook] unknown agent or hook: ${agent} ${hook}\n`);
    return;
  }
  const raw = readStdin().replace(/^\uFEFF/, '');
  let payload = {};
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return; // fail open
  }
  if (!payload || typeof payload !== 'object') return;
  const calls = translateInput(agent, hook, payload);
  if (!calls.length) return;
  const root = projectRoot(payload);
  const answer = translateOutput(agent, hook, combine(calls.map((c) => runKitHook(hook, c, root))));
  if (answer.stdout) process.stdout.write(answer.stdout);
  if (answer.stderr) process.stderr.write(answer.stderr);
  process.exitCode = answer.code;
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  main();
} catch (err) {
  // Fail open, but leave a trace in the agent's hook log.
  process.stderr.write(`[agent-setup:run-hook] ${err?.stack ?? err}\n`);
  process.exitCode = 0;
}
