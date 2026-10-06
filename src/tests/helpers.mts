// Shared test helpers: temp git repos and hook invocation the way Claude Code
// does it — a JSON payload on stdin, JSON (or nothing) on stdout, exit code 0.

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT: string = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOKS: string = join(ROOT, 'kit', 'hooks');
export const CLI: string = join(ROOT, 'bin', 'agent-setup.mjs');

const created: string[] = [];

export function tempDir(prefix: string = 'as-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTemp(): void {
  for (const d of created.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows can hold a handle briefly; leftovers in tmp are harmless.
    }
  }
}

export function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export const gitIn = (cwd: string, ...args: string[]): string => sh(cwd, 'git', args);

export interface MakeRepoOptions {
  branch?: string;
  branches?: string[];
  config?: unknown;
  learnings?: boolean;
}

/**
 * A throwaway repository with an initial commit on `main` and whatever other
 * branches are asked for, checked out on `branch`, with an optional sdlc config.
 */
export function makeRepo({ branch = 'develop', branches = ['develop'], config, learnings = false }: MakeRepoOptions = {}): string {
  const dir = tempDir('as-repo-');
  gitIn(dir, 'init', '-q', '-b', 'main');
  gitIn(dir, 'config', 'user.email', 'test@example.com');
  gitIn(dir, 'config', 'user.name', 'Test');
  gitIn(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# test\n');
  gitIn(dir, 'add', 'README.md');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  for (const b of branches) if (b !== 'main') gitIn(dir, 'branch', b);
  if (branch !== 'main') gitIn(dir, 'checkout', '-q', branch);
  if (config) writeConfig(dir, config);
  if (learnings) mkdirSync(join(dir, '.agents', 'learnings'), { recursive: true });
  return dir;
}

export function writeConfig(dir: string, config: unknown): void {
  mkdirSync(join(dir, '.agents'), { recursive: true });
  writeFileSync(join(dir, '.agents', 'sdlc.config.json'), JSON.stringify(config, null, 2));
}

export interface TwoTrunkBranching {
  model: string;
  production: string;
  integration: string;
  releaseOnRequestOnly: boolean;
  [key: string]: unknown;
}

export interface TwoTrunkConfig {
  version: number;
  branching: TwoTrunkBranching;
  sharedTree: boolean;
  gates: unknown[];
  [key: string]: unknown;
}

export const TWO_TRUNK: TwoTrunkConfig = {
  version: 1,
  branching: { model: 'two-trunk', production: 'main', integration: 'develop', releaseOnRequestOnly: true },
  sharedTree: false,
  gates: [],
};

export interface RunHookOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  allowStderr?: boolean;
}

export interface HookJson {
  __unparseable?: string;
  hookSpecificOutput?: {
    permissionDecision?: string;
    permissionDecisionReason?: string;
    additionalContext?: string;
    hookEventName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface HookResult {
  code: number | null;
  stdout: string;
  stderr: string;
  json: HookJson | null;
}

export function runHook(hook: string, payload: unknown, { cwd, env = {}, allowStderr = false }: RunHookOptions = {}): HookResult {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [join(HOOKS, hook)], {
    input,
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd ?? '', ...env },
    timeout: 20000,
  });
  // Hooks fail open and log swallowed errors to stderr. Any stderr in a test
  // is therefore a bug that production would hide — fail loudly here.
  if (!allowStderr && (r.stderr ?? '').trim()) {
    throw new Error(`${hook} wrote to stderr (a swallowed error):\n${r.stderr}`);
  }
  let json: HookJson | null = null;
  const out = (r.stdout ?? '').trim();
  if (out) {
    try {
      json = JSON.parse(out) as HookJson;
    } catch {
      json = { __unparseable: out };
    }
  }
  return { code: r.status, stdout: out, stderr: r.stderr, json };
}

/** Run guard-git against one command and return the deny reason, or null if allowed. */
export function guard(cwd: string, command: string, tool: string = 'Bash'): string | null {
  const r = runHook('guard-git.mjs', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } }, { cwd });
  if (r.code !== 0) throw new Error(`guard exited ${r.code}: ${r.stderr}`);
  if (!r.json) return null;
  if (r.json.__unparseable) throw new Error(`guard printed non-JSON: ${r.stdout}`);
  const o = r.json.hookSpecificOutput;
  return o?.permissionDecision === 'deny' ? (o?.permissionDecisionReason as string) : null;
}

// One registry and one inbox per test process, never the real ones in the kit.
const STATE: string = tempDir('as-state-');
const INBOX: string = tempDir('as-inbox-');

export interface RunCliOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  out: string;
}

export function runCli(args: string[], { cwd, env = {} }: RunCliOptions = {}): CliResult {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', AGENT_SETUP_STATE_DIR: STATE, AGENT_SETUP_INBOX_DIR: INBOX, ...env },
    timeout: 120000,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const testInbox = (): string => INBOX;
