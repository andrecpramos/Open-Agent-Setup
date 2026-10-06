// Shared test helpers: temp git repos and hook invocation the way Claude Code
// does it — a JSON payload on stdin, JSON (or nothing) on stdout, exit code 0.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOKS = join(ROOT, 'kit', 'hooks');
export const CLI = join(ROOT, 'bin', 'agent-setup.mjs');
const created = [];
export function tempDir(prefix = 'as-test-') {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}
export function cleanupTemp() {
    for (const d of created.splice(0)) {
        try {
            rmSync(d, { recursive: true, force: true });
        }
        catch {
            // Windows can hold a handle briefly; leftovers in tmp are harmless.
        }
    }
}
export function sh(cwd, cmd, args) {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export const gitIn = (cwd, ...args) => sh(cwd, 'git', args);
/**
 * A throwaway repository with an initial commit on `main` and whatever other
 * branches are asked for, checked out on `branch`, with an optional sdlc config.
 */
export function makeRepo({ branch = 'develop', branches = ['develop'], config, learnings = false } = {}) {
    const dir = tempDir('as-repo-');
    gitIn(dir, 'init', '-q', '-b', 'main');
    gitIn(dir, 'config', 'user.email', 'test@example.com');
    gitIn(dir, 'config', 'user.name', 'Test');
    gitIn(dir, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'README.md'), '# test\n');
    gitIn(dir, 'add', 'README.md');
    gitIn(dir, 'commit', '-q', '-m', 'init');
    for (const b of branches)
        if (b !== 'main')
            gitIn(dir, 'branch', b);
    if (branch !== 'main')
        gitIn(dir, 'checkout', '-q', branch);
    if (config)
        writeConfig(dir, config);
    if (learnings)
        mkdirSync(join(dir, '.agents', 'learnings'), { recursive: true });
    return dir;
}
export function writeConfig(dir, config) {
    mkdirSync(join(dir, '.agents'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'sdlc.config.json'), JSON.stringify(config, null, 2));
}
export const TWO_TRUNK = {
    version: 1,
    branching: { model: 'two-trunk', production: 'main', integration: 'develop', releaseOnRequestOnly: true },
    sharedTree: false,
    gates: [],
};
export function runHook(hook, payload, { cwd, env = {}, allowStderr = false } = {}) {
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
    let json = null;
    const out = (r.stdout ?? '').trim();
    if (out) {
        try {
            json = JSON.parse(out);
        }
        catch {
            json = { __unparseable: out };
        }
    }
    return { code: r.status, stdout: out, stderr: r.stderr, json };
}
/** Run guard-git against one command and return the deny reason, or null if allowed. */
export function guard(cwd, command, tool = 'Bash') {
    const r = runHook('guard-git.mjs', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } }, { cwd });
    if (r.code !== 0)
        throw new Error(`guard exited ${r.code}: ${r.stderr}`);
    if (!r.json)
        return null;
    if (r.json.__unparseable)
        throw new Error(`guard printed non-JSON: ${r.stdout}`);
    const o = r.json.hookSpecificOutput;
    return o?.permissionDecision === 'deny' ? o?.permissionDecisionReason : null;
}
// One registry and one inbox per test process, never the real ones in the kit.
const STATE = tempDir('as-state-');
const INBOX = tempDir('as-inbox-');
export function runCli(args, { cwd, env = {} } = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: cwd ?? ROOT,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', AGENT_SETUP_STATE_DIR: STATE, AGENT_SETUP_INBOX_DIR: INBOX, ...env },
        timeout: 120000,
    });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
export const testInbox = () => INBOX;
