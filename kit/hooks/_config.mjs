// Shared config loader for the Agent_Setup runtime hooks.
//
// Reads .agents/sdlc.config.json and fills in defaults (the reasons behind each default
// are in docs/SDLC.md in the agent-setup repository).
// Every hook in this directory depends on it; nothing else should.
//
// Contract: this module NEVER throws and NEVER exits non-zero. A SessionStart
// hook that errors blocks the session, so an unreadable or malformed config must
// degrade to sane defaults rather than take the session down with it. Every
// function here is written on that assumption.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Run git and return trimmed stdout, or null on any failure.
 * `cwd` defaults to the process cwd, which Claude Code sets to the session's
 * working directory when it runs a hook.
 */
export const git = (...args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
};

export const repoRoot = () => git('rev-parse', '--show-toplevel') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

export const insideWorkTree = () => git('rev-parse', '--is-inside-work-tree') === 'true';

/** Current branch name, or null when detached / not a repo. */
export const currentBranch = () => {
  const b = git('rev-parse', '--abbrev-ref', 'HEAD');
  return b && b !== 'HEAD' ? b : null;
};

/** Read one JSON file, tolerating a UTF-8 BOM. Returns null on any failure. */
export const readJson = (path) => {
  try {
    // A PowerShell-written JSON file carries a BOM that JSON.parse rejects
    // outright — a genuinely confusing failure to debug from inside a silent hook.
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
};

const DEFAULTS = {
  version: 1,
  project: {},
  branching: {
    model: 'two-trunk',
    production: 'main',
    integration: 'develop',
    featurePrefix: 'feature/',
    hotfixPrefix: 'hotfix/',
    releaseOnRequestOnly: true,
    protectedRefs: [],
  },
  sharedTree: false,
  commits: { convention: 'conventional', scopes: [], trailers: [] },
  gates: [],
  docs: { root: '.agents', rules: '.agents/docs/rules.md', decisions: '.agents/decisions' },
  guard: {
    denyProductionWrites: true,
    denyBranchFromProduction: true,
    denyCommitOnProduction: true,
    denyForcePushShared: true,
    denyDiscardUncommitted: true,
    denyNoVerify: true,
    extraDeny: [],
  },
  postEdit: [],
  workflow: {
    sessionSummary: false,
    verifyBeforeStop: true,
    contextWarnTokens: 150000,
    promptIntake: true,
    retroEvery: 20,
    askBranch: false,
    pullRequests: 'on-request',
    askMerge: false,
  },
};

/** Does this repository run every change as its own pull request (`workflow.pullRequests: "per-task"`)? */
export const prPerTask = (cfg) => cfg?.workflow?.pullRequests === 'per-task';

// Where the config may live, in priority order. `.agents/` is the home every agent reads;
// `.claude/` is where installs before 2.0 kept it (until `update` moves it), and a legacy
// `.ai/` root is still accepted, so this loader survives both migrations.
const CONFIG_PATHS = [
  ['.agents', 'sdlc.config.json'],
  ['.claude', 'sdlc.config.json'],
  ['.ai', 'sdlc.config.json'],
];

/**
 * Load the config, merged over defaults.
 *
 * `found: false` means the kit is installed but not configured — hooks then run
 * on defaults and say so, rather than pretending to enforce a contract nobody
 * actually wrote down. `provisional: true` means the installer wrote the config
 * from what git showed, and nobody has verified it yet (/sdlc-init does that).
 */
export function loadConfig() {
  const root = repoRoot();
  let raw = null;
  for (const parts of CONFIG_PATHS) {
    raw = readJson(join(root, ...parts));
    if (raw !== null) break;
  }
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) raw = null;

  const cfg = {
    ...DEFAULTS,
    ...(raw ?? {}),
    project: { ...DEFAULTS.project, ...(raw?.project ?? {}) },
    branching: { ...DEFAULTS.branching, ...(raw?.branching ?? {}) },
    commits: { ...DEFAULTS.commits, ...(raw?.commits ?? {}) },
    docs: { ...DEFAULTS.docs, ...(raw?.docs ?? {}) },
    guard: { ...DEFAULTS.guard, ...(raw?.guard ?? {}) },
    workflow: { ...DEFAULTS.workflow, ...(raw?.workflow ?? {}) },
    found: raw !== null,
    provisional: raw?._provisional === true,
    root,
  };

  // The trunk model has no separate integration branch: work lands on production
  // itself. Collapsing it here means no downstream hook needs to special-case it.
  if (cfg.branching.model === 'trunk' || !cfg.branching.integration) {
    cfg.branching.integration = cfg.branching.production;
  }

  // Broad staging is denied precisely when the tree is shared, unless the config
  // overrides it explicitly.
  if (cfg.guard.denyBroadStaging === undefined) {
    cfg.guard.denyBroadStaging = cfg.sharedTree === true;
  }

  if (!Array.isArray(cfg.gates)) cfg.gates = [];
  if (!Array.isArray(cfg.postEdit)) cfg.postEdit = [];
  if (!Array.isArray(cfg.branching.protectedRefs)) cfg.branching.protectedRefs = [];
  if (!Array.isArray(cfg.guard.extraDeny)) cfg.guard.extraDeny = [];

  return cfg;
}

/** An agent this project has, in the folder of any tool the kit set up (Claude Code, Codex, the home). */
export const hasAgent = (root, name) =>
  existsSync(join(root, '.claude', 'agents', `${name}.md`)) || existsSync(join(root, '.agents', 'agents', `${name}.md`)) || existsSync(join(root, '.codex', 'agents', `${name}.toml`));

/** The reviewer to name for risky work: the security reviewer where it applies, else the code reviewer, else null. */
export function reviewerFor(root, risks) {
  if (risks.some((r) => r !== 'production') && hasAgent(root, 'security-reviewer')) return 'security-reviewer';
  if (hasAgent(root, 'code-reviewer')) return 'code-reviewer';
  return null;
}

/**
 * The learnings folder: .agents/learnings, or .claude/learnings in an install from before 2.0
 * that `update` has not migrated yet. Hooks stay inert where neither exists.
 */
export function learningsDir(root) {
  const home = join(root, '.agents', 'learnings');
  const legacy = join(root, '.claude', 'learnings');
  return existsSync(home) || !existsSync(legacy) ? home : legacy;
}

/** The kit manifest of this project (.agents/agent-setup.json, or the pre-2.0 one), or null. */
export function readManifest(root) {
  return readJson(join(root, '.agents', 'agent-setup.json')) ?? readJson(join(root, '.claude', 'agent-setup.json'));
}

/** The configured gate commands: running one counts as checking the work. */
export function gateCommands(cfg) {
  return (Array.isArray(cfg?.gates) ? cfg.gates : []).map((g) => (typeof g?.command === 'string' ? g.command : '')).filter(Boolean);
}

/** Read a hook payload from stdin. Returns {} on malformed or absent input. */
export async function readPayload() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Record a swallowed error without failing the hook.
 *
 * Hooks fail open, which means a bug inside one is indistinguishable from "had
 * nothing to say" — the worst failure mode a hook can have. Claude Code sends
 * the stderr of an exit-0 hook to its debug log only, so writing here costs the
 * session nothing, shows up under `claude --debug`, and lets the test suite fail
 * on any hook that errors. Two such bugs (a temporal-dead-zone ReferenceError
 * swallowed by a catch-all) were found exactly this way.
 */
export function logError(hook, err) {
  try {
    process.stderr.write(`[agent-setup:${hook}] ${err?.stack ?? err}\n`);
  } catch {
    // nothing left to do
  }
}

/**
 * Emit additionalContext for SessionStart / UserPromptSubmit / PostToolUse, then exit 0.
 * `userMessage`, when given, is shown to the person only (a systemMessage the model never
 * sees): reminders that are theirs to act on stay out of the agent's replies.
 */
export function emitContext(eventName, text, userMessage = '') {
  const out = {};
  if (text && text.trim()) out.hookSpecificOutput = { hookEventName: eventName, additionalContext: text };
  if (userMessage && userMessage.trim()) out.systemMessage = userMessage;
  if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

/**
 * Minimal glob matcher: supports globstar, star, ? and {a,b} against
 * POSIX-separated paths.
 *
 * Translated in a single pass rather than by chained String.replace, because the
 * chained form needs sentinel characters to stop a globstar being re-matched by
 * the single-star rule — and a sentinel that survives into source is a control
 * byte that editors, diff tools and copy-paste all mangle.
 *
 * A globstar crosses directory separators; a single star does not. That
 * distinction is what makes `src/*.ts` and `src/**` mean different things.
 * Brace groups were added because Claude Code's own `paths:` globs accept them,
 * and a config that works in one place and silently matches nothing in the other
 * is the vacuous-gate failure in miniature.
 */
export function matchGlob(pattern, path) {
  const p = String(path).replace(/\\/g, '/');
  const src = String(pattern).replace(/\\/g, '/');
  const SPECIAL = '.+^$()|[]\\';
  let rx = '';
  let braceDepth = 0;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '*') {
      if (src[i + 1] === '*') {
        if (src[i + 2] === '/') {
          // `a/**/b` must also match `a/b`, so the segment group is optional.
          rx += '(?:.*/)?';
          i += 2;
        } else {
          rx += '.*';
          i += 1;
        }
      } else {
        rx += '[^/]*';
      }
    } else if (c === '?') {
      rx += '[^/]';
    } else if (c === '{') {
      braceDepth++;
      rx += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      rx += ')';
    } else if (c === ',' && braceDepth > 0) {
      rx += '|';
    } else if (SPECIAL.includes(c) || c === '{' || c === '}') {
      rx += '\\' + c;
    } else {
      rx += c;
    }
  }

  try {
    return new RegExp('^' + rx + '$').test(p);
  } catch {
    return false;
  }
}

/** True when `ref` equals or glob-matches any pattern (e.g. `release/*`). */
export function refMatches(patterns, ref) {
  if (!ref) return false;
  return patterns.some((pat) => pat === ref || (pat.includes('*') && matchGlob(pat, ref)));
}
