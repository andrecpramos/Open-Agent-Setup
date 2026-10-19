// End-to-end tests for the agent-setup CLI against real temporary repositories.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, unlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeRepo, runCli, gitIn, cleanupTemp, tempDir, ROOT, testInbox } from './helpers.mjs';
import { hashText } from '../lib/util.mjs';
import { specProblems } from '../lib/vendor.mjs';
import { EVAL_METHOD } from '../lib/routing.mjs';
after(cleanupTemp);
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const manifest = (repo) => json(join(repo, '.agents', 'agent-setup.json'));
const isLink = (p) => {
    try {
        return lstatSync(p).isSymbolicLink();
    }
    catch {
        return false;
    }
};
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const catalog = json(join(ROOT, 'kit', 'catalog.json'));
const group = (g) => (Object.entries(catalog.skills).filter(([, m]) => m.group === g).map(([n]) => n));
const CORE = group('core');
const DESIGN = group('design');
const ADMIN = group('admin');
/** What a default install brings: the standard profile, the workflow, and the admin role's skills. */
const STANDARD = catalog.profiles.standard.skills;
const DEFAULT = [...STANDARD, ...CORE, ...ADMIN];
function nodeApp() {
    const repo = makeRepo({ branch: 'develop', branches: ['develop'] });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' }, dependencies: { zod: '3.0.0' } }));
    writeFileSync(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    return repo;
}
const setupClone = (repo, ...args) => spawnSync(process.execPath, [join(repo, '.agents', 'hooks', 'setup-clone.mjs'), ...args], { cwd: repo, encoding: 'utf8' });
// ---------------------------------------------------------------------------
describe('install into a fresh repository (standard profile, any agent)', () => {
    const repo = nodeApp();
    const r = runCli(['install', repo]);
    test('exits 0 and says, in plain words, what it added, how to undo it and what comes next', () => {
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /Agent_Setup .* → .*installed/);
        assert.match(r.out, /Setup\s+standard — the general engineering skills and the delivery workflow\. Chosen from what the project contains/);
        assert.match(r.out, /It added:\n\s+AGENTS\.md\s+the instructions every coding agent reads \(a new file\)/);
        assert.match(r.out, /\.agents\/\s+the kit, in one folder \(its README\.md says what each part is\)/);
        assert.match(r.out, /skills\/\s+12 playbooks the agent opens when the work matches — frontend, backend, api-design/);
        assert.match(r.out, /Nothing else changes: no npm packages, nothing installed globally, none of your files overwritten\./);
        assert.match(r.out, /Undo at any time: node ".*agent-setup\.mjs" uninstall ".*"/);
        assert.match(r.out, /Agents\s+none found — AGENTS\.md and the skills work in any agent/);
        assert.match(r.out, /Want the hooks too\? Add it, e\.g\. --targets agents,claude \(any of: claude, codex, cursor, copilot, antigravity, windsurf\)/);
        assert.match(r.out, /Ask it to "follow \.agents\/skills\/sdlc-init\/SKILL\.md"/);
        assert.match(r.out, /Look at what changed \(git status\), then commit it\./);
        assert.doesNotMatch(r.out, /hook handler\(s\)|permission rule/, 'mechanics stay out of the plain report');
    });
    test('puts a README in .agents/ that says what the folder is and how to remove it', () => {
        const readme = read(join(repo, '.agents', 'README.md'));
        assert.match(readme, /what this folder is/);
        assert.match(readme, /\| `hooks\/` \|/);
        assert.match(readme, /To remove all of it/);
        assert.ok(manifest(repo).files['.agents/README.md'], 'kit-owned: updated with the kit, removed by uninstall');
    });
    test('installs the standard skills, the workflow and the admin skills once, in .agents/skills; nothing opt-in', () => {
        for (const s of DEFAULT)
            assert.ok(existsSync(join(repo, '.agents', 'skills', s, 'SKILL.md')), `.agents/skills/${s}`);
        for (const s of [...DESIGN, 'design-system', 'agent-eval'])
            assert.equal(existsSync(join(repo, '.agents', 'skills', s)), false, `${s} is opt-in`);
        assert.deepEqual(manifest(repo).selection.roles, ['developer', 'admin']);
        assert.deepEqual(readdirSync(join(repo, '.agents', 'licenses')), ['agent-setup.txt'], "no vendored skill: only the kit's own notice");
        assert.match(read(join(repo, '.agents', 'licenses', 'agent-setup.txt')), /^MIT License/);
    });
    test('writes nothing for Claude Code: no .claude/, no CLAUDE.md, no links', () => {
        assert.equal(existsSync(join(repo, '.claude')), false);
        assert.equal(existsSync(join(repo, 'CLAUDE.md')), false);
        assert.deepEqual(manifest(repo).links, {});
        assert.deepEqual(manifest(repo).selection.targets, ['agents']);
    });
    test('installs the agents as procedures, and of the hooks only the per-clone setup script', () => {
        for (const a of ['gate-runner', 'security-reviewer', 'architecture-reviewer', 'docs-keeper', 'scout'])
            assert.ok(existsSync(join(repo, '.agents', 'agents', `${a}.md`)), a);
        // The runtime hooks run in Claude Code only; without that target they would be dead weight.
        assert.deepEqual(readdirSync(join(repo, '.agents', 'hooks')), ['setup-clone.mjs']);
    });
    test('never installs skill evals into projects', () => {
        assert.equal(existsSync(join(repo, '.agents', 'skills', 'frontend', 'evals')), false);
    });
    test('writes AGENTS.md with detected commands and the managed block', () => {
        const a = read(join(repo, 'AGENTS.md'));
        assert.match(a, /pnpm install --frozen-lockfile/);
        assert.match(a, /pnpm run typecheck/);
        assert.match(a, /<!-- agent-setup:begin -->[\s\S]*## How work flows here[\s\S]*## Working agreement[\s\S]*<!-- agent-setup:end -->/);
        assert.match(a, /\| Review \| `code-reviewer` \| high \| a change across several files or layers/);
        assert.match(a, /### Who does what, on which model[\s\S]*\| Tier \| Use it for \| Claude \| OpenAI \| Gemini \|/, "no tool named: every provider's column");
        assert.match(a, /\| high \| [^|]+ \| `claude-opus-5-5` · high \| `gpt-6\.1-sol` · high \| `gemini-3\.1-pro-preview` \|/, 'model ids, not Claude Code aliases, without the claude target');
        assert.match(a, /## Learning loop/, 'the admin role brings the learning loop');
        assert.match(a, /`frontend` · `backend` · `api-design` · `security` · `architecture` for the areas; `deliver` · `gates` · `ship-it` · `handoff` for the workflow; `sdlc-init` · `self-improve` · `enforcement-audit` for whoever maintains the setup, run by name only/);
        assert.doesNotMatch(a, /## Skills/, 'the skills are named once, in the working agreement: their descriptions are the agent\'s already');
        assert.match(a, /\| Explore \| `scout` \|[\s\S]*\| Plan \| `planner` \|[\s\S]*\| Build \| `implementer` \|[\s\S]*\| Verify \| `gate-runner` \|[\s\S]*\| Review \| `security-reviewer` \|[\s\S]*\| Docs \| `doc-writer` \|/, 'the team table reads in the order of the cycle');
        assert.match(a, /\.agents\/skills/);
        assert.match(a, /\.agents\/agents/);
        assert.doesNotMatch(a, /## Claude Code/, 'no Claude Code section without the target');
        assert.doesNotMatch(a, /\{\{[A-Z_]+\}\}/, 'unrendered placeholder');
    });
    test('writes a provisional two-trunk config from the branches it found', () => {
        const cfg = json(join(repo, '.agents', 'sdlc.config.json'));
        assert.equal(cfg._provisional, true);
        assert.equal(cfg.branching.model, 'two-trunk');
        assert.equal(cfg.branching.production, 'main');
        assert.equal(cfg.branching.integration, 'develop');
    });
    test('adds the gitignore block and the learning loop scaffolding', () => {
        const gi = read(join(repo, '.gitignore'));
        assert.match(gi, /^\.agents\/learnings\/signals\.jsonl$/m);
        assert.doesNotMatch(gi, /\.claude|CLAUDE/, 'no Claude Code entries without the target');
        assert.doesNotMatch(gi, /# agent-setup:begin[\s\S]*\n\n[\s\S]*# agent-setup:end/, 'no blank lines inside the block');
        assert.ok(existsSync(join(repo, '.agents', 'learnings', 'inbox.md')));
        assert.ok(existsSync(join(repo, '.agents', 'learnings', 'README.md')));
        assert.ok(existsSync(join(repo, '.agents', 'overlays', 'README.md')));
    });
    test('records every kit file in the manifest, in .agents/', () => {
        const m = manifest(repo);
        assert.equal(m.kit.name, 'agent-setup');
        assert.equal(m.selection.profile, 'standard');
        assert.ok(Object.keys(m.files).length > 50);
        assert.ok(m.files['.agents/hooks/setup-clone.mjs']);
        assert.ok(m.files['.agents/skills/gates/SKILL.md']);
        assert.equal(Object.keys(m.files).some((f) => f.startsWith('.claude/')), false);
    });
    test('refuses a second install', () => {
        const again = runCli(['install', repo]);
        assert.equal(again.code, 1);
        assert.match(again.out, /already installed/);
    });
    test('status is healthy apart from the provisional config', () => {
        const st = runCli(['status', repo]);
        assert.equal(st.code, 0, st.out);
        assert.match(st.out, /provisional/);
        assert.doesNotMatch(st.out, /link\(s\) for Claude Code missing/);
        assert.doesNotMatch(st.out, /is not wired/, 'no settings to check without the Claude Code target');
        assert.match(st.out, /Claude Code hooks: not targeted — every agent is bound by AGENTS\.md alone/);
    });
    test('a second update changes nothing', () => {
        const u = runCli(['update', repo]);
        assert.equal(u.code, 0, u.out);
        assert.doesNotMatch(u.out, /\b(added|updated|restored|conflict|removed)\b/);
    });
});
// ---------------------------------------------------------------------------
describe('install for Claude Code (a project with .claude/)', () => {
    const repo = nodeApp();
    // A project that already uses Claude Code: personal settings, nothing the kit owns.
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'settings.local.json'), '{}\n');
    const r = runCli(['install', repo]);
    test('detects Claude Code and targets it', () => {
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /Agents\s+Claude Code\n/);
        assert.match(r.out, /Type \/sdlc-init\. It reads your CI and branches/);
        assert.match(r.out, /\.claude\/settings\.json\s+turns the hooks on in Claude Code/);
        assert.match(r.out, /hooks\/\s+9 small scripts Claude Code runs/);
        assert.deepEqual(manifest(repo).selection.targets, ['agents', 'claude']);
    });
    test('links .claude/skills to the one copy in .agents/skills', () => {
        for (const s of DEFAULT) {
            const link = join(repo, '.claude', 'skills', s);
            assert.ok(isLink(link), `.claude/skills/${s} is a link`);
            // Both sides resolved natively: a temp folder can be spelled in 8.3 short form (Windows CI
            // runners), which only the native resolver expands.
            assert.ok(same(realpathSync.native(link), realpathSync.native(join(repo, '.agents', 'skills', s))), `${s} points at .agents/skills`);
            assert.equal(isLink(join(repo, '.agents', 'skills', s)), false, `.agents/skills/${s} is the real folder`);
        }
        assert.deepEqual(Object.keys(manifest(repo).links).sort(), DEFAULT.map((s) => `.claude/skills/${s}`).sort());
        assert.equal(Object.keys(manifest(repo).files).some((f) => f.startsWith('.claude/skills/')), false, 'links are not kit files');
    });
    test('keeps the links and the personal files out of git', () => {
        const gi = read(join(repo, '.gitignore'));
        assert.match(gi, /^\.claude\/skills\/frontend$/m);
        assert.match(gi, /^\.claude\/settings\.local\.json$/m);
        assert.match(gi, /^CLAUDE\.local\.md$/m);
        const status = gitIn(repo, 'status', '--porcelain', '--untracked-files=all');
        assert.doesNotMatch(status, /\.claude\/skills\//, status);
    });
    test('installs every hook, the CLI-only declarations excepted', () => {
        for (const h of ['_config.mjs', '_transcript.mjs', 'branch-check.mjs', 'guard-git.mjs', 'check-gates.mjs', 'learning-signals.mjs', 'session-eval.mjs', 'stop-check.mjs', 'context-budget.mjs', 'setup-clone.mjs', 'prompt-intake.mjs']) {
            assert.ok(existsSync(join(repo, '.agents', 'hooks', h)), h);
        }
        assert.equal(existsSync(join(repo, '.agents', 'hooks', '_transcript.d.mts')), false, 'the CLI-only type declarations stay in the kit');
        assert.equal(existsSync(join(repo, '.claude', 'hooks')), false);
    });
    test('puts the subagents where Claude Code reads them', () => {
        for (const a of ['gate-runner', 'security-reviewer', 'architecture-reviewer', 'docs-keeper', 'scout'])
            assert.ok(existsSync(join(repo, '.claude', 'agents', `${a}.md`)), a);
        assert.equal(existsSync(join(repo, '.agents', 'agents')), false, 'one copy of each agent');
    });
    test('creates no CLAUDE.md: Claude Code reads AGENTS.md, which has a Claude Code section', () => {
        assert.equal(existsSync(join(repo, 'CLAUDE.md')), false);
        const a = read(join(repo, 'AGENTS.md'));
        assert.match(a, /## Claude Code/);
        assert.match(a, /When one\s+speaks, act on it[\s\S]*a check or a review asked for — run it; an INTAKE note —\s+write the brief; a\s+ROUTE note — hand the work to the agent it names; a PR note — open the\s+draft PR before your first edit/);
        assert.match(a, /Commit or open a PR only\s+when asked — unless `workflow\.pullRequests` in `\.agents\/sdlc\.config\.json` is `per-task`/, 'every agent reads the per-task mode, hooks or not');
        // Subagents with project memory write it under the directory they start in.
        assert.match(a, /spawn them from the repository root/);
        assert.match(a, /pass the Agent tool's `model`/, 'how to move one run up a tier');
        assert.match(a, /\.claude\/agents/);
        assert.match(a, /\/reload-skills/);
        assert.doesNotMatch(a, /\{\{[A-Z_]+\}\}/, 'unrendered placeholder');
    });
    test('wires hooks in exec form from .agents/hooks, and adds permissions', () => {
        const s = json(join(repo, '.claude', 'settings.json'));
        const guard = s.hooks.PreToolUse.find((g) => g.matcher === 'Bash|PowerShell');
        assert.equal(guard.hooks[0].command, 'node');
        assert.deepEqual(guard.hooks[0].args, ['${CLAUDE_PROJECT_DIR}/.agents/hooks/guard-git.mjs']);
        assert.ok(s.permissions.ask.includes('Edit(.agents/sdlc.config.json)'));
        for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure'])
            assert.ok(s.hooks[e], e);
        const first = s.hooks.SessionStart[0].hooks[0];
        assert.deepEqual(first.args, ['${CLAUDE_PROJECT_DIR}/.agents/hooks/setup-clone.mjs', '--hook'], 'the session repairs the links of a fresh clone');
        assert.equal(json(join(repo, '.claude', 'settings.local.json')).hooks, undefined, 'personal settings untouched');
    });
    test('status is healthy and counts the links', () => {
        const st = runCli(['status', repo]);
        assert.equal(st.code, 0, st.out);
        assert.match(st.out, new RegExp(`${DEFAULT.length} link\\(s\\) for Claude Code`));
        assert.doesNotMatch(st.out, /link\(s\) for Claude Code missing/);
        assert.doesNotMatch(st.out, /is not wired/);
    });
    test('a second update changes nothing', () => {
        const u = runCli(['update', repo]);
        assert.equal(u.code, 0, u.out);
        assert.doesNotMatch(u.out, /\b(added|updated|restored|conflict|removed)\b/);
    });
    test('dropping the target removes everything the kit had in .claude/, and only that', () => {
        const u = runCli(['update', repo, '--targets', 'agents']);
        assert.equal(u.code, 0, u.out);
        assert.deepEqual(readdirSync(join(repo, '.claude')), ['settings.local.json']);
        assert.ok(existsSync(join(repo, '.agents', 'agents', 'gate-runner.md')), 'the agents move to .agents/agents');
        assert.ok(existsSync(join(repo, '.agents', 'skills', 'gates', 'SKILL.md')), 'the skills stay');
        assert.doesNotMatch(read(join(repo, 'AGENTS.md')), /## Claude Code/);
        assert.deepEqual(manifest(repo).links, {});
    });
});
// ---------------------------------------------------------------------------
describe('the design group', () => {
    const repo = nodeApp();
    const r = runCli(['install', repo, '--profile', 'web', '--skills', '@design', '--targets', 'agents,claude']);
    test('opt-in: the web profile alone leaves the design skills out', () => {
        const plain = nodeApp();
        assert.equal(runCli(['install', plain, '--profile', 'web']).code, 0);
        for (const s of DESIGN)
            assert.equal(existsSync(join(plain, '.agents', 'skills', s)), false, `${s} costs ~22k tokens a load, or a CLI per machine: asked for, never assumed`);
        assert.ok(existsSync(join(plain, '.agents', 'skills', 'design-system', 'SKILL.md')));
    });
    test('--skills @design installs both design skills, named in the report', () => {
        assert.equal(r.code, 0, r.out);
        for (const s of DESIGN)
            assert.ok(existsSync(join(repo, '.agents', 'skills', s, 'SKILL.md')), s);
        assert.match(r.out, /npm i -g agent-browser && agent-browser install/, 'the one machine-wide step the browser skill needs is said');
        assert.doesNotMatch(r.out, /MB to this repository/, 'nothing heavy lands');
    });
    test('installs one licence per upstream source, reachable from both skill folders', () => {
        const licences = readdirSync(join(repo, '.agents', 'licenses')).sort();
        assert.deepEqual(licences, [...readdirSync(join(ROOT, 'kit', 'developer', 'licenses')), 'agent-setup.txt'].sort());
        assert.ok(isLink(join(repo, '.claude', 'licenses')));
        const lic = read(join(repo, '.agents', 'skills', 'design-taste-frontend', 'SKILL.md')).match(/^license: .*\(see ([^)]+)\)/m)?.[1];
        assert.ok(lic, 'design-taste-frontend names its licence file');
        assert.ok(existsSync(join(repo, '.agents', 'skills', 'design-taste-frontend', lic)), 'from .agents/skills');
        assert.ok(existsSync(join(repo, '.claude', 'skills', 'design-taste-frontend', lic)), 'from .claude/skills');
        for (const s of DESIGN)
            assert.equal(existsSync(join(repo, '.agents', 'skills', s, 'LICENSE')), false, `${s} carries no copy`);
    });
    test('AGENTS.md names each design skill', () => {
        const a = read(join(repo, 'AGENTS.md'));
        for (const s of DESIGN)
            assert.match(a, new RegExp(`\`${s}\``), s);
    });
    test('--skills @design adds the group to any profile; --exclude removes one skill', () => {
        const other = nodeApp();
        const i = runCli(['install', other, '--profile', 'minimal', '--skills', '@design', '--exclude', 'agent-browser']);
        assert.equal(i.code, 0, i.out);
        const installed = readdirSync(join(other, '.agents', 'skills')).sort();
        assert.deepEqual(installed, [...CORE, ...ADMIN, 'design-taste-frontend'].sort());
    });
});
// ---------------------------------------------------------------------------
describe('other agents: the same hooks through each agent\'s own hook file', () => {
    // A project that shows Cursor (with a hook of its own) and Copilot.
    const repo = nodeApp();
    mkdirSync(join(repo, '.cursor'));
    writeFileSync(join(repo, '.cursor', 'hooks.json'), JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }] } }));
    mkdirSync(join(repo, '.github'));
    writeFileSync(join(repo, '.github', 'copilot-instructions.md'), '# ours\n');
    const r = runCli(['install', repo]);
    const cursorHooks = () => json(join(repo, '.cursor', 'hooks.json'));
    test('detects the agents the project shows, and wires each in its own file', () => {
        assert.equal(r.code, 0, r.out);
        assert.deepEqual(manifest(repo).selection.targets, ['agents', 'cursor', 'copilot']);
        assert.match(r.out, /Agents\s+Cursor, GitHub Copilot/);
        assert.match(r.out, /\.cursor\/hooks\.json\s+turns on the git guard, the post-edit checks and the branch note in Cursor \(merged with what is there\)/);
        assert.match(r.out, /\.github\/hooks\/agent-setup\.json/);
        const copilot = json(join(repo, '.github', 'hooks', 'agent-setup.json'));
        assert.equal(copilot.version, 1);
        assert.equal(copilot.hooks.preToolUse[0].command, 'node .agents/hooks/run-hook.mjs copilot guard-git');
        for (const h of ['run-hook.mjs', 'guard-git.mjs', 'check-gates.mjs', 'branch-check.mjs'])
            assert.ok(existsSync(join(repo, '.agents', 'hooks', h)), h);
        assert.equal(existsSync(join(repo, '.claude')), false, 'no Claude Code here, so nothing of it');
        assert.match(read(join(repo, 'AGENTS.md')), /In Cursor and GitHub Copilot sessions a hook denies it; in any other agent this line is the rule/);
    });
    test("keeps the project's own hooks, and a second update changes nothing", () => {
        assert.deepEqual(cursorHooks().hooks.afterFileEdit, [{ command: './format.sh' }]);
        assert.equal(cursorHooks().hooks.beforeShellExecution[0].command, 'node .agents/hooks/run-hook.mjs cursor guard-git');
        const u = runCli(['update', repo]);
        assert.equal(u.code, 0, u.out);
        assert.doesNotMatch(u.out, /\b(added|updated|restored|conflict|removed)\b/);
    });
    test('a kit hook the user deleted stays deleted, until --reset-hooks', () => {
        const file = join(repo, '.cursor', 'hooks.json');
        const j = cursorHooks();
        delete j.hooks.sessionStart;
        writeFileSync(file, JSON.stringify(j, null, 2));
        runCli(['update', repo]);
        assert.equal(cursorHooks().hooks.sessionStart, undefined);
        runCli(['update', repo, '--reset-hooks']);
        assert.ok(cursorHooks().hooks.sessionStart, '--reset-hooks brings it back');
    });
    test('more agents with --targets; Codex is told to trust the hooks; the roles decide which hooks', () => {
        const other = nodeApp();
        const i = runCli(['install', other, '--targets', 'agents,codex,antigravity,windsurf', '--roles', 'developer']);
        assert.equal(i.code, 0, i.out);
        assert.match(i.out, /type \/hooks in Codex and approve the agent-setup ones/);
        const codex = json(join(other, '.codex', 'hooks.json'));
        assert.deepEqual(Object.keys(codex.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'UserPromptSubmit']);
        assert.equal(codex.hooks.UserPromptSubmit[0].hooks.length, 1, 'no learning-signals without the admin role');
        assert.equal(json(join(other, '.agents', 'hooks.json'))['agent-setup'].PreToolUse[0].matcher, 'run_command');
        assert.equal(json(join(other, '.windsurf', 'hooks.json')).hooks.pre_run_command[0].command, 'node .agents/hooks/run-hook.mjs windsurf guard-git');
    });
    test('dropping a target takes its hooks out; uninstall leaves only what the project had', () => {
        const d = runCli(['update', repo, '--targets', 'agents,cursor']);
        assert.equal(d.code, 0, d.out);
        assert.equal(existsSync(join(repo, '.github', 'hooks')), false, 'the kit wrote that file alone, so it goes');
        const u = runCli(['uninstall', repo]);
        assert.equal(u.code, 0, u.out);
        assert.deepEqual(cursorHooks(), { version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }] } });
        assert.ok(existsSync(join(repo, '.github', 'copilot-instructions.md')));
    });
});
// ---------------------------------------------------------------------------
describe('install into an existing setup (brownfield)', () => {
    const repo = makeRepo({ branch: 'main', branches: [] });
    writeFileSync(join(repo, 'CLAUDE.md'), '# Existing\n\nUse pnpm, never npm.\n');
    writeFileSync(join(repo, 'AGENTS.md'), '# Existing agents file\n\nKeep this.\n');
    mkdirSync(join(repo, '.claude', 'skills', 'backend'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'backend', 'SKILL.md'), '---\nname: backend\ndescription: ours\n---\n# ours\n');
    // Hook wiring the project already had (Bash only), pointing at a guard of its own.
    const env = {};
    writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({
        permissions: { allow: ['Bash(npm run lint:*)'] },
        hooks: {
            PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard-git.mjs' }] }],
            Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
        },
    }));
    const r = runCli(['install', repo], { env });
    test('succeeds', () => assert.equal(r.code, 0, r.out));
    test('keeps the project content of CLAUDE.md and AGENTS.md; CLAUDE.md imports AGENTS.md', () => {
        const c = read(join(repo, 'CLAUDE.md'));
        assert.match(c, /Use pnpm, never npm\./);
        assert.match(c, /^@AGENTS\.md$/m, 'with a CLAUDE.md, Claude Code reads AGENTS.md only through the import');
        const a = read(join(repo, 'AGENTS.md'));
        assert.match(a, /Keep this\./);
        assert.match(a, /agent-setup:begin/);
    });
    test('a CLAUDE.md with project content and no AGENTS.md is flagged for /sdlc-init', () => {
        const other = makeRepo({ branch: 'main', branches: [] });
        writeFileSync(join(other, 'CLAUDE.md'), '# Ours\n\nUse pnpm.\n');
        const i = runCli(['install', other], { env });
        assert.equal(i.code, 0, i.out);
        assert.match(i.out, /CLAUDE\.md already holds project instructions that only Claude Code reads/);
        assert.match(read(join(other, 'CLAUDE.md')), /^@AGENTS\.md$/m);
    });
    test('skips a kit skill the project already has, and says so', () => {
        assert.match(read(join(repo, '.claude', 'skills', 'backend', 'SKILL.md')), /# ours/);
        assert.match(r.out, /Kept yours\s+your project already has a skill named backend/);
        assert.ok(manifest(repo).skipped.skills.includes('backend'));
        assert.equal(existsSync(join(repo, '.agents', 'skills', 'backend')), false, 'no second copy');
        assert.equal(manifest(repo).links['.claude/skills/backend'], undefined, 'no link over a skill the kit does not own');
    });
    test('a hook file the project already has is never overwritten', () => {
        const other = makeRepo({ branch: 'main', branches: [] });
        mkdirSync(join(other, '.agents', 'hooks'), { recursive: true });
        writeFileSync(join(other, '.agents', 'hooks', 'guard-git.mjs'), '// my own guard\n');
        const i = runCli(['install', other, '--targets', 'agents,claude'], { env });
        assert.equal(i.code, 0, i.out);
        assert.equal(read(join(other, '.agents', 'hooks', 'guard-git.mjs')), '// my own guard\n');
        assert.ok(existsSync(join(other, '.agents', 'hooks', 'guard-git.mjs.kit-new')));
    });
    test('adds only the missing PowerShell coverage to the existing guard wiring', () => {
        const s = json(join(repo, '.claude', 'settings.json'));
        const groups = s.hooks.PreToolUse;
        const guards = groups.flatMap((g) => g.hooks.map((h) => ({ m: g.matcher, cmd: `${h.command} ${(h.args ?? []).join(' ')}` }))).filter((x) => x.cmd.includes('guard-git'));
        assert.equal(guards.length, 2, JSON.stringify(groups));
        assert.ok(guards.some((g) => g.m === 'Bash'));
        assert.ok(guards.some((g) => g.m === 'PowerShell'));
        const stops = s.hooks.Stop.flatMap((g) => g.hooks.map((h) => `${h.command} ${(h.args ?? []).join(' ')}`.trim()));
        assert.deepEqual(stops, ['echo mine', 'node ${CLAUDE_PROJECT_DIR}/.agents/hooks/stop-check.mjs'], 'the project Stop hook is kept; the kit adds its own beside it');
        assert.ok(s.permissions.allow.includes('Bash(npm run lint:*)'));
    });
    test('uninstall removes exactly what it added', () => {
        const u = runCli(['uninstall', repo], { env });
        assert.equal(u.code, 0, u.out);
        const s = json(join(repo, '.claude', 'settings.json'));
        assert.deepEqual(s.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard-git.mjs' }] }]);
        assert.deepEqual(s.hooks.Stop, [{ hooks: [{ type: 'command', command: 'echo mine' }] }], 'the project Stop hook is back exactly as it was');
        assert.deepEqual(s.permissions, { allow: ['Bash(npm run lint:*)'] });
        assert.equal(read(join(repo, 'CLAUDE.md')), '# Existing\n\nUse pnpm, never npm.\n');
        assert.equal(read(join(repo, 'AGENTS.md')), '# Existing agents file\n\nKeep this.\n');
        assert.match(read(join(repo, '.claude', 'skills', 'backend', 'SKILL.md')), /# ours/);
        assert.equal(existsSync(join(repo, '.claude', 'skills', 'frontend')), false);
        assert.equal(existsSync(join(repo, '.claude', 'agents')), false);
        assert.equal(existsSync(join(repo, '.agents', 'skills')), false);
        assert.equal(existsSync(join(repo, '.agents', 'agent-setup.json')), false);
        // project-owned files stay
        assert.ok(existsSync(join(repo, '.agents', 'learnings', 'inbox.md')));
    });
});
// ---------------------------------------------------------------------------
describe("Claude Code's links, per clone", () => {
    const repo = nodeApp();
    runCli(['install', repo, '--profile', 'minimal', '--targets', 'agents,claude']);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'chore: agent-setup');
    test('a fresh clone has no links until setup-clone runs, then has all of them', () => {
        const clone = join(tempDir('as-clone-'), 'c');
        gitIn(repo, 'clone', '-q', repo, clone);
        assert.equal(existsSync(join(clone, '.claude', 'skills')), false, 'links are never committed');
        assert.ok(existsSync(join(clone, '.agents', 'skills', 'gates', 'SKILL.md')), 'the skills are');
        const s = setupClone(clone);
        assert.equal(s.status, 0, s.stderr);
        assert.match(s.stdout, new RegExp(`${CORE.length + ADMIN.length} link\\(s\\) created`));
        for (const k of [...CORE, ...ADMIN])
            assert.ok(existsSync(join(clone, '.claude', 'skills', k, 'SKILL.md')), k);
        assert.match(setupClone(clone).stdout, /already in place/, 'idempotent');
    });
    test("Claude Code's session start links a fresh clone and says to reload, once", () => {
        const clone = join(tempDir('as-clone-'), 'c');
        gitIn(repo, 'clone', '-q', repo, clone);
        const first = setupClone(clone, '--hook');
        assert.equal(first.status, 0, first.stderr);
        const msg = JSON.parse(first.stdout);
        assert.match(msg.systemMessage, new RegExp(`linked ${CORE.length + ADMIN.length} kit skill\\(s\\) into \\.claude/skills .* /reload-skills`));
        for (const k of [...CORE, ...ADMIN])
            assert.ok(isLink(join(clone, '.claude', 'skills', k)), k);
        const again = setupClone(clone, '--hook');
        assert.equal(again.status, 0, again.stderr);
        assert.equal(again.stdout, '', 'nothing to say when nothing changed');
    });
    test('status reports missing links and setup-clone repairs them', () => {
        unlinkSync(join(repo, '.claude', 'skills', 'gates'));
        assert.match(runCli(['status', repo]).out, new RegExp(`1 of ${CORE.length + ADMIN.length} link\\(s\\) for Claude Code missing`));
        setupClone(repo);
        assert.ok(isLink(join(repo, '.claude', 'skills', 'gates')));
    });
    test('a real folder where a link belongs is left alone and reported', () => {
        const p = join(repo, '.claude', 'skills', 'handoff');
        unlinkSync(p);
        mkdirSync(p);
        writeFileSync(join(p, 'mine.md'), 'mine\n');
        assert.match(setupClone(repo).stdout, /handoff is a real folder, not a link — left alone/);
        assert.equal(read(join(p, 'mine.md')), 'mine\n');
        rmSync(p, { recursive: true });
        setupClone(repo);
    });
    test('uninstall removes the links, never what they point to', () => {
        const skill = join(repo, '.agents', 'skills', 'gates', 'SKILL.md');
        writeFileSync(skill, `${read(skill)}\n<!-- local change -->\n`);
        const u = runCli(['uninstall', repo]);
        assert.equal(u.code, 0, u.out);
        assert.equal(existsSync(join(repo, '.claude', 'skills')), false);
        assert.match(read(skill), /local change/, 'the modified skill survives');
        assert.equal(existsSync(join(repo, '.agents', 'skills', 'handoff')), false, 'unmodified skills are removed');
    });
});
// ---------------------------------------------------------------------------
describe('upgrade from 1.x (the kit lived in .claude/, links ran the other way)', () => {
    const repo = nodeApp();
    runCli(['install', repo, '--profile', 'minimal', '--skills', 'design-taste-frontend', '--targets', 'agents,claude']);
    // Rewrite the install the way 1.x left it: the one copy of every kit file in .claude/, the
    // manifest beside it, .agents/skills/<name> linking into .claude/skills, project files in
    // .claude/, a CLAUDE.md holding only the kit's block, and the design pack selected by name.
    setupClone(repo, '--uninstall');
    const toV1 = (p) => p.replace(/^\.agents\//, '.claude/');
    const m = manifest(repo);
    const files = {};
    for (const [rel, h] of Object.entries(m.files)) {
        files[toV1(rel)] = h;
        if (rel === toV1(rel))
            continue;
        mkdirSync(join(repo, toV1(rel), '..'), { recursive: true });
        cpSync(join(repo, rel), join(repo, toV1(rel)));
    }
    for (const name of ['sdlc.config.json', 'learnings', 'overlays'])
        cpSync(join(repo, '.agents', name), join(repo, '.claude', name), { recursive: true });
    rmSync(join(repo, '.agents'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'learnings', 'inbox.md'), `# Learnings inbox\n${lesson('2026-09-28', 'project')}`);
    writeFileSync(join(repo, '.claude', 'overlays', 'backend.md'), '# Backend overlay\n\nOur rule.\n');
    const settings = join(repo, '.claude', 'settings.json');
    writeFileSync(settings, read(settings).replace(/\.agents\/hooks\//g, '.claude/hooks/').replace(/\.agents\//g, '.claude/'));
    writeFileSync(join(repo, 'CLAUDE.md'), '<!-- agent-setup:begin -->\n@AGENTS.md\n<!-- agent-setup:end -->\n');
    const links = {};
    for (const name of readdirSync(join(repo, '.claude', 'skills'))) {
        links[`.agents/skills/${name}`] = `.claude/skills/${name}`;
        mkdirSync(join(repo, '.agents', 'skills'), { recursive: true });
        symlinkSync(join(repo, '.claude', 'skills', name), join(repo, '.agents', 'skills', name), 'junction');
    }
    // The user had removed one handler; 1.x recorded the choice against its .claude/hooks/ path.
    const v1Settings = JSON.parse(read(settings));
    delete v1Settings.hooks.PreCompact;
    writeFileSync(settings, JSON.stringify(v1Settings, null, 2));
    const added = JSON.parse(JSON.stringify(m.settings.added).replace(/\.agents\//g, '.claude/'));
    const removedByUser = added.hooks.filter((h) => h.event === 'PreCompact').map((h) => `${h.event}|${h.signature}`);
    const v1 = {
        ...m,
        files,
        links,
        selection: { ...m.selection, skills: [], packs: ['frontend-kit'], targets: ['claude', 'agents'] },
        settings: { added: { ...added, hooks: added.hooks.filter((h) => h.event !== 'PreCompact') }, removedByUser },
    };
    writeFileSync(join(repo, '.claude', 'agent-setup.json'), JSON.stringify(v1));
    rmSync(join(repo, '.agents', 'agent-setup.json'), { force: true });
    const u = runCli(['update', repo]);
    test('moves the kit into .agents/ and turns the links around', () => {
        assert.equal(u.code, 0, u.out);
        assert.ok(existsSync(join(repo, '.agents', 'agent-setup.json')));
        assert.equal(existsSync(join(repo, '.claude', 'agent-setup.json')), false, 'the old manifest is gone');
        assert.equal(isLink(join(repo, '.agents', 'skills', 'gates')), false, '.agents/skills holds the real folders');
        assert.ok(existsSync(join(repo, '.agents', 'skills', 'gates', 'SKILL.md')));
        assert.ok(isLink(join(repo, '.claude', 'skills', 'gates')), '.claude/skills links to them');
        assert.equal(existsSync(join(repo, '.claude', 'hooks')), false);
        assert.equal(existsSync(join(repo, '.claude', 'WORKFLOW.md')), false);
        assert.ok(existsSync(join(repo, '.agents', 'hooks', 'guard-git.mjs')));
        assert.equal(Object.keys(manifest(repo).files).some((f) => f.startsWith('.claude/skills/') || f.startsWith('.claude/hooks/')), false);
    });
    test('moves the project files with it, unchanged', () => {
        assert.match(read(join(repo, '.agents', 'learnings', 'inbox.md')), /Scope component styles/);
        assert.equal(read(join(repo, '.agents', 'overlays', 'backend.md')), '# Backend overlay\n\nOur rule.\n');
        assert.ok(existsSync(join(repo, '.agents', 'sdlc.config.json')));
        for (const name of ['learnings', 'overlays', 'sdlc.config.json'])
            assert.equal(existsSync(join(repo, '.claude', name)), false, name);
        assert.match(u.out, /moved to the \.agents\/ home: \.claude\/sdlc\.config\.json, \.claude\/learnings, \.claude\/overlays/);
    });
    test('rewires the hooks and drops the CLAUDE.md that held only the kit block', () => {
        const s = read(settings);
        assert.doesNotMatch(s, /\.claude\/hooks\//);
        assert.match(s, /\$\{CLAUDE_PROJECT_DIR\}\/\.agents\/hooks\/guard-git\.mjs/);
        assert.equal(JSON.parse(s).hooks.PreCompact, undefined, 'a handler removed under 1.x stays removed');
        assert.equal(existsSync(join(repo, 'CLAUDE.md')), false);
    });
    test('keeps the design skills a pack install had', () => {
        for (const s of DESIGN)
            assert.ok(existsSync(join(repo, '.agents', 'skills', s, 'SKILL.md')), s);
        assert.deepEqual(manifest(repo).selection.skills, ['@design']);
        assert.equal(manifest(repo).selection.packs, undefined);
    });
    test('a second update changes nothing', () => {
        const again = runCli(['update', repo]);
        assert.equal(again.code, 0, again.out);
        assert.doesNotMatch(again.out, /\b(added|updated|restored|conflict|removed|moved)\b/);
    });
});
// ---------------------------------------------------------------------------
describe('update never destroys local work', () => {
    const repo = nodeApp();
    runCli(['install', repo, '--targets', 'agents,claude']);
    test('a locally modified kit file is kept; the new version lands beside it', () => {
        const skill = join(repo, '.agents', 'skills', 'backend', 'SKILL.md');
        writeFileSync(skill, `${read(skill)}\n<!-- local tweak -->\n`);
        // Pretend the kit shipped a different version of the file.
        const m = manifest(repo);
        m.files['.agents/skills/backend/SKILL.md'] = '0'.repeat(32);
        writeFileSync(join(repo, '.agents', 'agent-setup.json'), JSON.stringify(m));
        const u = runCli(['update', repo]);
        assert.equal(u.code, 0, u.out);
        assert.match(read(skill), /local tweak/);
        assert.ok(existsSync(`${skill}.kit-new`));
        assert.match(u.out, /conflict/);
    });
    test('a deleted kit file is restored', () => {
        rmSync(join(repo, '.claude', 'agents', 'gate-runner.md'));
        const u = runCli(['update', repo]);
        assert.match(u.out, /restored/);
        assert.ok(existsSync(join(repo, '.claude', 'agents', 'gate-runner.md')));
    });
    test('a hook handler the user removed stays removed', () => {
        const p = join(repo, '.claude', 'settings.json');
        const s = json(p);
        delete s.hooks.UserPromptSubmit;
        writeFileSync(p, JSON.stringify(s, null, 2));
        runCli(['update', repo]);
        assert.equal(json(p).hooks.UserPromptSubmit, undefined);
        runCli(['update', repo, '--reset-hooks']);
        assert.ok(json(p).hooks.UserPromptSubmit, '--reset-hooks brings it back');
    });
    test('excluding a skill on update removes it when unmodified', () => {
        const u = runCli(['update', repo, '--exclude', 'api-design']);
        assert.equal(u.code, 0, u.out);
        assert.equal(existsSync(join(repo, '.agents', 'skills', 'api-design')), false);
    });
    test('a skill an older manifest names that the kit no longer has is dropped, with a note', () => {
        const m = manifest(repo);
        m.selection.skills = ['brandkit', '@design'];
        writeFileSync(join(repo, '.agents', 'agent-setup.json'), JSON.stringify(m));
        const u = runCli(['update', repo]);
        assert.equal(u.code, 0, u.out);
        assert.match(u.out, /no longer in the kit, dropped from the selection: brandkit/);
        assert.deepEqual(manifest(repo).selection.skills, ['@design']);
    });
    test('refuses to touch invalid settings.json', () => {
        const p = join(repo, '.claude', 'settings.json');
        const good = read(p);
        writeFileSync(p, '{ not json');
        const u = runCli(['update', repo]);
        assert.equal(u.code, 1);
        assert.match(u.out, /not valid JSON/);
        assert.equal(read(p), '{ not json');
        writeFileSync(p, good);
    });
});
// ---------------------------------------------------------------------------
describe('selection options', () => {
    test('--dry-run writes nothing', () => {
        const repo = nodeApp();
        const r = runCli(['install', repo, '--dry-run']);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /preview — nothing is written yet/);
        assert.match(r.out, /It will add:/);
        assert.match(r.out, /Nothing was written\. Run the same command without --dry-run to install\./);
        assert.equal(existsSync(join(repo, '.claude')), false);
        assert.equal(existsSync(join(repo, '.agents')), false);
        assert.equal(existsSync(join(repo, 'AGENTS.md')), false);
    });
    test('profile minimal installs only the workflow skills and the agents that need no domain skill', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        const skills = readdirSync(join(repo, '.agents', 'skills')).sort();
        assert.deepEqual(skills, [...CORE, ...ADMIN].sort());
        const agents = readdirSync(join(repo, '.agents', 'agents')).sort();
        assert.deepEqual(agents, ['code-reviewer.md', 'doc-writer.md', 'docs-keeper.md', 'gate-runner.md', 'implementer.md', 'planner.md', 'scout.md']);
    });
    test('--targets claude still keeps the one copy in .agents/; gemini adds GEMINI.md', () => {
        const a = nodeApp();
        runCli(['install', a, '--targets', 'claude']);
        assert.deepEqual(manifest(a).selection.targets, ['agents', 'claude']);
        assert.ok(isLink(join(a, '.claude', 'skills', 'gates')));
        const b = nodeApp();
        runCli(['install', b, '--targets', 'agents,gemini']);
        const g = read(join(b, 'GEMINI.md'));
        assert.match(g, /@\.\/AGENTS\.md/);
        assert.match(g, /\.agents\/skills/);
        assert.match(g, /branch protection/);
        assert.equal(existsSync(join(b, '.claude')), false);
    });
    test('--roles developer leaves the admin role out: its skills, agent, hooks and the learning loop', () => {
        const repo = nodeApp();
        const r = runCli(['install', repo, '--roles', 'developer', '--targets', 'agents,claude']);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /Role\s+developer only — no setup, audit or learning-loop tools/);
        assert.deepEqual(manifest(repo).selection.roles, ['developer']);
        const skills = readdirSync(join(repo, '.agents', 'skills')).sort();
        assert.deepEqual(skills, [...STANDARD, ...CORE].sort());
        assert.equal(existsSync(join(repo, '.claude', 'agents', 'docs-keeper.md')), false);
        for (const h of ['session-eval.mjs', 'learning-signals.mjs', 'context-budget.mjs'])
            assert.equal(existsSync(join(repo, '.agents', 'hooks', h)), false, h);
        for (const h of ['guard-git.mjs', 'stop-check.mjs', 'prompt-intake.mjs', '_transcript.mjs'])
            assert.ok(existsSync(join(repo, '.agents', 'hooks', h)), h);
        const wired = read(join(repo, '.claude', 'settings.json'));
        assert.doesNotMatch(wired, /session-eval|learning-signals|context-budget/);
        assert.match(wired, /guard-git/);
        assert.equal(existsSync(join(repo, '.agents', 'learnings')), false, 'no learning loop');
        const a = read(join(repo, 'AGENTS.md'));
        assert.doesNotMatch(a, /## Learning loop|sdlc-init` ·/);
        assert.match(r.out, /Check \.agents\/sdlc\.config\.json: the branch names, and the exact commands your CI runs/);
        const back = runCli(['update', repo, '--roles', 'developer,admin']);
        assert.equal(back.code, 0, back.out);
        assert.ok(existsSync(join(repo, '.agents', 'skills', 'sdlc-init', 'SKILL.md')), 'the admin role can be added later');
        assert.ok(existsSync(join(repo, '.agents', 'learnings', 'inbox.md')));
    });
    test('an unknown role is an error', () => {
        const r = runCli(['install', nodeApp(), '--roles', 'manager']);
        assert.equal(r.code, 1);
        assert.match(r.out, /unknown role "manager"/);
    });
    test('a first install takes the setup that fits what the project contains; --profile overrides it', () => {
        const repo = nodeApp();
        writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'shop', dependencies: { react: '19.0.0', express: '5.0.0' } }));
        const r = runCli(['install', repo]);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /Setup\s+web — full-stack web product/);
        assert.equal(manifest(repo).selection.profile, 'web');
        assert.ok(existsSync(join(repo, '.agents', 'skills', 'design-system', 'SKILL.md')));
        for (const s of DESIGN)
            assert.equal(existsSync(join(repo, '.agents', 'skills', s)), false, `${s} is opt-in`);
        assert.match(runCli(['update', repo]).out, /profile web/, 'an update keeps it');
        const given = nodeApp();
        writeFileSync(join(given, 'package.json'), JSON.stringify({ name: 'shop', dependencies: { react: '19.0.0', express: '5.0.0' } }));
        const g = runCli(['install', given, '--profile', 'service']);
        assert.match(g.out, /Setup\s+service — backend service or API$/m, 'a given profile is not called detected');
    });
    test('--no-hooks installs no Claude Code hooks and no hook wiring, but still the per-clone setup', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--no-hooks', '--targets', 'agents,claude']);
        assert.equal(existsSync(join(repo, '.agents', 'hooks', 'guard-git.mjs')), false);
        assert.ok(existsSync(join(repo, '.agents', 'hooks', 'setup-clone.mjs')));
        const s = json(join(repo, '.claude', 'settings.json'));
        assert.equal(s.hooks, undefined);
    });
    test('unknown profile, skill or group is an error', () => {
        const repo = nodeApp();
        assert.equal(runCli(['install', repo, '--profile', 'nope']).code, 1);
        assert.equal(runCli(['install', repo, '--skills', 'nope']).code, 1);
        const g = runCli(['install', repo, '--skills', '@nope']);
        assert.equal(g.code, 1);
        assert.match(g.out, /unknown group "@nope"/);
    });
    test('--packs explains its replacement instead of running', () => {
        const r = runCli(['install', nodeApp(), '--packs', 'frontend-kit']);
        assert.equal(r.code, 1);
        assert.match(r.out, /--skills @design/);
    });
});
// ---------------------------------------------------------------------------
describe('the retired git-hooks layer', () => {
    const hooksPathOf = (repo) => {
        try {
            return gitIn(repo, 'config', '--get', 'core.hooksPath');
        }
        catch {
            return null; // `git config --get` exits 1 when the key is unset — the expected state
        }
    };
    test('update says it is gone, and setup-clone takes its hooks out of the clone', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        const m = manifest(repo);
        m.selection.gitHooks = true;
        writeFileSync(join(repo, '.agents', 'agent-setup.json'), JSON.stringify(m));
        // What a 2.x install left in the clone: a hooks folder in the git directory, wired in.
        const dest = join(repo, '.git', 'agent-setup', 'hooks');
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, 'pre-commit'), '#!/bin/sh\nexit 1\n');
        gitIn(repo, 'config', 'core.hooksPath', dest.replace(/\\/g, '/'));
        assert.match(runCli(['status', repo]).out, /the retired agent-setup git hooks are still active in this clone/);
        const u = runCli(['update', repo]);
        assert.equal(u.code, 0, u.out);
        assert.match(u.out, /the git-hooks layer is retired/);
        assert.equal(existsSync(join(repo, '.git', 'agent-setup')), false);
        assert.equal(hooksPathOf(repo), null);
        assert.equal(manifest(repo).selection.gitHooks, undefined);
    });
    test('setup-clone knows its hooks folder however the path to it is spelled', () => {
        // git reports the real path; the setting may name the same folder another way — a short 8.3
        // name on Windows, a link such as macOS /var → /private/var. A link to the repository stands in.
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        const dest = join(repo, '.git', 'agent-setup', 'hooks');
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, 'pre-commit'), '#!/bin/sh\nexit 1\n');
        const alias = join(tempDir(), 'alias');
        symlinkSync(repo, alias, 'junction');
        try {
            gitIn(repo, 'config', 'core.hooksPath', join(alias, '.git', 'agent-setup', 'hooks').replace(/\\/g, '/'));
            const r = setupClone(repo);
            assert.equal(r.status, 0, r.stderr);
            assert.equal(existsSync(join(repo, '.git', 'agent-setup')), false);
            assert.equal(hooksPathOf(repo), null);
        }
        finally {
            unlinkSync(alias); // never a recursive delete through a link
        }
    });
    test('--git-hooks explains its replacement instead of running', () => {
        const r = runCli(['install', nodeApp(), '--git-hooks']);
        assert.equal(r.code, 1);
        assert.match(r.out, /--git-hooks is gone[\s\S]*branch/);
    });
});
// ---------------------------------------------------------------------------
describe('harvest', () => {
    test('moves outbox proposals into the kit inbox and archives them in the project', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        const outbox = join(repo, '.agents', 'learnings', 'outbox');
        mkdirSync(outbox, { recursive: true });
        writeFileSync(join(outbox, '2026-09-26-backend-race.md'), '# Proposal: check-then-act\n');
        const h = runCli(['harvest', '--from', repo]);
        assert.equal(h.code, 0, h.out);
        assert.ok(readdirSync(testInbox()).some((f) => f.endsWith('2026-09-26-backend-race.md')));
        assert.ok(existsSync(join(outbox, 'harvested', '2026-09-26-backend-race.md')));
        assert.equal(existsSync(join(outbox, '2026-09-26-backend-race.md')), false);
    });
    test('names projects whose universal lessons never left the inbox', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        writeFileSync(join(repo, '.agents', 'learnings', 'inbox.md'), `# Learnings inbox\n${lesson('2026-09-28', 'universal')}${lesson('2026-09-29', 'project')}`);
        const h = runCli(['harvest', '--from', repo]);
        assert.equal(h.code, 0, h.out);
        assert.match(h.out, /waiting .*: 1 universal lesson\(s\) in its inbox since 2026-09-28 — run \/self-improve retro/);
    });
});
/** One learnings-inbox entry in the format of kit/templates/learnings-README.md. */
function lesson(date, scope) {
    return `\n## ${date} — Scope component styles to their block class\n- **What happened:** a bare h2 rule leaked.\n- **Lesson:** nest element selectors.\n- **Evidence:** Page.scss.\n- **Scope:** ${scope}\n- **Skill:** frontend\n`;
}
// ---------------------------------------------------------------------------
describe('status: what the version string misses', () => {
    const writeManifest = (repo, m) => writeFileSync(join(repo, '.agents', 'agent-setup.json'), `${JSON.stringify(m, null, 2)}\n`);
    test('an install from an older build of the same version counts the files update would change', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        assert.match(runCli(['status', repo]).out, /\(current\)/);
        // An older build of the same version: the file and its recorded hash agree, the kit has moved on.
        const m = manifest(repo);
        const rel = Object.keys(m.files).find((f) => f.startsWith('.agents/skills/') && f.endsWith('/SKILL.md'));
        const old = `${read(join(repo, rel))}\nAn older build of this skill.\n`;
        writeFileSync(join(repo, rel), old);
        m.files[rel] = hashText(old);
        writeManifest(repo, m);
        const st = runCli(['status', repo]);
        assert.equal(st.code, 0, st.out);
        assert.match(st.out, /same version, but update would change 1 file\(s\)/);
        assert.doesNotMatch(st.out, /modified locally/);
        assert.equal(runCli(['update', repo]).code, 0);
        assert.match(runCli(['status', repo]).out, /\(current\)/);
    });
    test('an install from another copy of the kit says so', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        const m = manifest(repo);
        m.kit.source = 'C:/elsewhere/agent-setup';
        writeManifest(repo, m);
        assert.match(runCli(['status', repo]).out, /installed from another copy of the kit \(C:\/elsewhere\/agent-setup\) — run update from this one/);
    });
    test('a project outside the registry is named, and status --all says when the registry is empty', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        const env = { AGENT_SETUP_STATE_DIR: tempDir('as-state-') };
        assert.match(runCli(['status', repo], { env }).out, /not in this kit's project registry, so harvest, update --all and evals skip it/);
        const all = runCli(['status', '--all'], { env });
        assert.equal(all.code, 0, all.out);
        assert.match(all.out, /No registered projects\. `install` registers a new one; `update <project>` registers an existing install\./);
        assert.doesNotMatch(runCli(['status', repo]).out, /project registry/);
    });
    test('universal lessons waiting in the inbox are counted and flagged', () => {
        const repo = nodeApp();
        runCli(['install', repo, '--profile', 'minimal']);
        writeFileSync(join(repo, '.agents', 'learnings', 'inbox.md'), `# Learnings inbox\n${lesson('2026-09-28', 'universal')}${lesson('2026-09-29', 'project')}`);
        const st = runCli(['status', repo]);
        assert.match(st.out, /2 in inbox \(1 universal\)/);
        assert.match(st.out, /1 universal lesson\(s\) waiting in the learnings inbox since 2026-09-28 — run \/self-improve retro/);
    });
});
// ---------------------------------------------------------------------------
describe('kit commands', () => {
    test('lint passes on the kit with no warnings', () => {
        const l = runCli(['lint']);
        assert.equal(l.code, 0, l.out);
        assert.match(l.out, /0 errors, 0 warning\(s\)/);
    });
    test('list shows every group, the agents and the profiles', () => {
        const l = runCli(['list']);
        assert.equal(l.code, 0, l.out);
        for (const g of ['@domain', '@core', '@design', '@admin', 'role developer', 'role admin'])
            assert.match(l.out, new RegExp(g));
        assert.match(l.out, /design-taste-frontend\s+vendored/);
        assert.match(l.out, /deliver\s+own/);
        assert.match(l.out, /docs-keeper\s+admin/);
        assert.match(l.out, /session-eval\s+admin/);
        assert.match(l.out, /guard-git\s+developer/);
        assert.match(l.out, /default: standard/);
    });
    test('vendor status works offline and lists only vendored repositories', () => {
        const v = runCli(['vendor', 'status', '--offline']);
        assert.doesNotMatch(v.out, /Derived|sdlc-kit/);
        assert.match(v.out, /taste-skill\s+locked [0-9a-f]{12}/);
    });
    test('with no command: the two commands an adopter needs, and where the rest is', () => {
        const r = runCli([]);
        assert.equal(r.code, 0);
        assert.match(r.out, /Add it to a project\s+node .*agent-setup\.mjs install <path-to-your-project>/);
        assert.match(r.out, /asks before writing anything/);
        assert.match(r.out, /Remove it again\s+node .*agent-setup\.mjs uninstall <path-to-your-project>/);
        assert.ok(r.out.split('\n').length < 15, 'one screen');
    });
    test('help and version', () => {
        const h = runCli(['help']).out;
        assert.match(h, /install <project>/);
        assert.match(h, /vendor sync/);
        assert.match(h, /eval-routing/);
        assert.match(runCli(['version']).out, /^\d+\.\d+\.\d+/);
    });
    test('retired commands and options explain their replacement', () => {
        const u = runCli(['upstream']);
        assert.equal(u.code, 1);
        assert.match(u.out, /vendor status/);
        const n = runCli(['new-skill', 'x-y', '--pack', 'vendor']);
        assert.equal(n.code, 1);
        assert.match(n.out, /--group/);
    });
    test('unknown command fails', () => assert.equal(runCli(['frobnicate']).code, 1));
    test('refuses to install into the kit itself', () => {
        const r = runCli(['install', ROOT]);
        assert.equal(r.code, 1);
        assert.match(r.out, /into itself/);
    });
});
// ---------------------------------------------------------------------------
describe('export: self-contained copies for routes that copy one folder at a time', () => {
    const out = join(tempDir('as-export-'), 'portable');
    const r = runCli(['export', out, '--profile', 'full']);
    const skills = join(out, 'skills');
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    test('exports every selected skill, without evals', () => {
        assert.equal(r.code, 0, r.out);
        assert.deepEqual(readdirSync(skills).sort(), Object.keys(catalog.skills).sort());
        assert.equal(walk(skills).some((f) => /[\\/]evals[\\/]/.test(f)), false);
        assert.ok(existsSync(join(out, 'README.md')));
    });
    test('each vendored folder carries its licence, and its frontmatter points at it', () => {
        assert.equal(read(join(skills, 'design-taste-frontend', 'LICENSE')), read(join(ROOT, 'kit', 'developer', 'licenses', 'taste-skill.txt')));
        assert.equal(read(join(skills, 'agent-browser', 'LICENSE')), read(join(ROOT, 'kit', 'developer', 'licenses', 'agent-browser.txt')));
        assert.match(read(join(skills, 'design-taste-frontend', 'SKILL.md')), /^license: "MIT \(see LICENSE\)"$/m);
        assert.match(read(join(skills, 'deliver', 'LICENSE')), /^MIT License/, "the kit's own skills carry the kit's licence");
    });
    test('nothing refers to the shared licences folder, and every SKILL.md is within the spec', () => {
        for (const f of walk(skills).filter((x) => x.endsWith('.md')))
            assert.doesNotMatch(read(f), /\.\.\/\.\.\/licenses\//, f);
        for (const s of readdirSync(skills))
            assert.deepEqual(specProblems(read(join(skills, s, 'SKILL.md')), s), [], s);
        assert.doesNotMatch(read(join(skills, 'sdlc-init', 'SKILL.md')), /^(context|agent|background|disable-model-invocation):/m);
        assert.match(r.out, /removed Claude-only keys: .*enforcement-audit \(context, agent, background, disable-model-invocation\)/);
    });
    test('--roles admin exports only the admin skills, for a per-user install', () => {
        const adminOut = join(tempDir('as-export-'), 'admin');
        const a = runCli(['export', adminOut, '--roles', 'admin']);
        assert.equal(a.code, 0, a.out);
        assert.deepEqual(readdirSync(join(adminOut, 'skills')).sort(), [...ADMIN].sort());
    });
    test('refuses a non-empty target without --force, and a target inside the kit', () => {
        const again = runCli(['export', out]);
        assert.equal(again.code, 1);
        assert.match(again.out, /not empty/);
        assert.equal(runCli(['export', out, '--force']).code, 0);
        const inside = runCli(['export', join(ROOT, 'dist')]);
        assert.equal(inside.code, 1);
        assert.match(inside.out, /outside the kit/);
        assert.equal(existsSync(join(ROOT, 'dist')), false);
    });
});
// ---------------------------------------------------------------------------
describe('lint keeps the repository tidy', () => {
    // A copy of the kit with one of each kind of pollution the gate exists to stop.
    const copy = join(tempDir('as-kit-'), 'Agent_Setup');
    cpSync(ROOT, copy, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.state)([\\/]|$)/.test(src.slice(ROOT.length)) });
    mkdirSync(join(copy, 'frontend-kit'));
    writeFileSync(join(copy, 'frontend-kit', 'README.md'), '# a second home for a theme\n');
    cpSync(join(copy, 'kit', 'developer', 'licenses', 'taste-skill.txt'), join(copy, 'docs', 'taste-licence-copy.txt'));
    writeFileSync(join(copy, 'docs', 'shell-mangled.md'), `**Skills:** ${String.fromCharCode(7)}gent-eval\n`);
    writeFileSync(join(copy, 'docs', 'hidden.md'), `before${String.fromCharCode(0xfeff)}after\n`);
    writeFileSync(join(copy, 'lib', 'hidden.mjs'), `export const x = '${String.fromCharCode(0x200b)}';\n`);
    mkdirSync(join(copy, 'docs', 'empty'));
    const routing = join(copy, 'kit', 'developer', 'skills', 'deliver', 'evals', 'routing.json');
    // An admin skill that would load into every developer session, and a skill in both roles.
    const selfImprove = join(copy, 'kit', 'admin', 'skills', 'self-improve', 'SKILL.md');
    writeFileSync(selfImprove, readFileSync(selfImprove, 'utf8').replace(/^disable-model-invocation: true\n/m, ''));
    cpSync(join(copy, 'kit', 'developer', 'skills', 'handoff'), join(copy, 'kit', 'admin', 'skills', 'handoff'), { recursive: true });
    writeFileSync(join(copy, 'kit', 'developer', 'stray.md'), '# not a role folder entry\n');
    const suite = JSON.parse(readFileSync(routing, 'utf8'));
    suite.scope.push('agent:nope');
    suite.cases[0].need = ['agent:docs-keeper'];
    suite.fixture = 'missing';
    writeFileSync(routing, JSON.stringify(suite, null, 2));
    // An agent off its tier's model, and a tier model with no price.
    const scout = join(copy, 'kit', 'developer', 'agents', 'scout.md');
    writeFileSync(scout, readFileSync(scout, 'utf8').replace(/^model: haiku$/m, 'model: sonnet'));
    const models = join(copy, 'kit', 'models.json');
    const table = JSON.parse(readFileSync(models, 'utf8'));
    delete table.prices['gpt-6-luna'];
    writeFileSync(models, JSON.stringify(table, null, 2));
    const l = spawnSync(process.execPath, [join(copy, 'bin', 'agent-setup.mjs'), 'lint'], { cwd: copy, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    const out = `${l.stdout}${l.stderr}`;
    test('fails', () => assert.equal(l.status, 1, out));
    test('a folder that is not in the documented layout', () => assert.match(out, /frontend-kit\n\s+✖ error\s+not in the Layout tables of AGENTS\.md/));
    test('two files with the same content', () => {
        assert.match(out, /(docs\/taste-licence-copy\.txt|kit\/developer\/licenses\/taste-skill\.txt)\n\s+✖ error\s+identical to (kit\/developer\/licenses\/taste-skill\.txt|docs\/taste-licence-copy\.txt)/);
    });
    test('a control character left by shell quoting', () => assert.match(out, /docs\/shell-mangled\.md\n\s+✖ error\s+control character 0x07 on line 1/));
    test('an invisible BOM in prose and a zero-width space in code', () => {
        assert.match(out, /docs\/hidden\.md\n\s+✖ error\s+invisible character U\+FEFF/);
        assert.match(out, /lib\/hidden\.mjs\n\s+✖ error\s+invisible character U\+200B/);
    });
    test('an empty folder', () => assert.match(out, /docs\/empty\n\s+⚠ warn\s+empty folder/));
    test('roles: an admin skill that loads on its own, one name in both roles, a stray file in a role folder', () => {
        assert.match(out, /admin skills set `disable-model-invocation: true`/);
        assert.match(out, /a skill named "handoff" is also in kit\/developer\/skills — one name, one role/);
        assert.match(out, /kit\/developer\/stray\.md\n\s+✖ error\s+a role folder holds only skills, agents, licenses\//);
    });
    test('a routing suite with an unknown agent, a case judged outside its scope, or no fixture', () => {
        assert.match(out, /scope names unknown agent "agent:nope"/);
        assert.match(out, /need names "agent:docs-keeper", which is not in the suite's scope/);
        assert.match(out, /fixture "missing" is not a folder under evals\//);
    });
    test('an agent whose model is not its tier, and a tier model nobody can price', () => {
        assert.match(out, /kit\/developer\/agents\/scout\.md\n\s+✖ error\s+model "sonnet" but the catalog puts it on the low tier: `model: haiku`/);
        assert.match(out, /provider "openai", tier "low": no price for gpt-6-luna/);
    });
});
// ---------------------------------------------------------------------------
// eval-routing trigger suites, run against a fake agent (no model calls)
// ---------------------------------------------------------------------------
describe('eval-routing: trigger suites and scorecards', () => {
    const dir = tempDir('as-fake-agent-');
    const fake = (name, loads) => {
        const file = join(dir, `${name}.mjs`);
        writeFileSync(file, [
            'const p = process.argv[2] || "";',
            `const load = ${loads};`,
            'console.log(JSON.stringify({ type: "system", subtype: "init", model: "fake-model" }));',
            'if (load) console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "agent-setup:handoff" } }] } }));',
        ].join('\n'));
        return JSON.stringify([process.execPath, file, '{prompt}']);
    };
    const smart = fake('smart', '/handoff|wrap up|clear|passagem/i.test(p)');
    const eager = fake('eager', 'true');
    const cards = join(dir, 'scorecards');
    test('a trigger suite passes when the skill loads exactly for its should-trigger queries', () => {
        const r = runCli(['eval-routing', '--suite', 'trigger', '--skill', 'handoff', '--cmd', smart, '--save', '--scorecards', cards]);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /handoff\/should\s+4\/4\s+100%/);
        assert.match(r.out, /handoff\/should-not\s+4\/4\s+100%/);
        const card = JSON.parse(readFileSync(join(cards, 'trigger.latest.json'), 'utf8'));
        assert.equal(card.suite, 'trigger');
        assert.equal(card.model, 'fake-model');
        assert.equal(card.method, EVAL_METHOD);
        assert.deepEqual(card.buckets['handoff/should'].passed, 4);
        assert.equal(card.metrics.trials, 8);
    });
    test('an eager skill fails its near-misses; repeated runs count trials and merge into the scorecard', () => {
        const r = runCli(['eval-routing', '--suite', 'trigger', '--skill', 'handoff', '--only', 't01,t05', '--runs', '2', '--cmd', eager, '--save', '--scorecards', cards]);
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /FAIL\s+0\/2\s+handoff\/t05 -/);
        assert.match(r.out, /handoff loaded for a near-miss/);
        const card = JSON.parse(readFileSync(join(cards, 'trigger.latest.json'), 'utf8'));
        assert.deepEqual({ passed: card.buckets['handoff/should-not'].passed, total: card.buckets['handoff/should-not'].total, runs: card.buckets['handoff/should-not'].runs }, { passed: 0, total: 2, runs: 2 });
    });
    test('after a promote, a one-skill rerun starts from the baseline and keeps the other buckets', () => {
        const promoted = tempDir('as-promoted-');
        writeFileSync(join(promoted, 'trigger.baseline.json'), JSON.stringify({ suite: 'trigger', method: EVAL_METHOD, model: 'fake-model', date: '2026-09-28', runs: 1, buckets: { 'other/should': { passed: 3, total: 4, runs: 1, date: '2026-09-28' } } }));
        const r = runCli(['eval-routing', '--suite', 'trigger', '--skill', 'handoff', '--cmd', smart, '--save', '--scorecards', promoted]);
        assert.equal(r.code, 0, r.out);
        assert.doesNotMatch(r.out, /not merged/);
        const card = JSON.parse(readFileSync(join(promoted, 'trigger.latest.json'), 'utf8'));
        assert.deepEqual(Object.keys(card.buckets).sort(), ['handoff/should', 'handoff/should-not', 'other/should']);
        assert.equal(card.buckets['other/should'].passed, 3);
    });
    test('a scorecard of another method or model is never merged into a new run', () => {
        for (const [stamp, why] of [
            [{}, /trigger\.baseline\.json was measured with method unstamped, this one with \d+ — not merged/],
            [{ method: EVAL_METHOD, model: 'older-model' }, /trigger\.baseline\.json was measured on older-model, this one on fake-model — not merged/],
        ]) {
            const old = tempDir('as-old-');
            writeFileSync(join(old, 'trigger.baseline.json'), JSON.stringify({ suite: 'trigger', model: 'fake-model', ...stamp, date: '2026-09-28', runs: 1, buckets: { 'other/should': { passed: 3, total: 4, runs: 1, date: '2026-09-28' } } }));
            const r = runCli(['eval-routing', '--suite', 'trigger', '--skill', 'handoff', '--cmd', smart, '--save', '--scorecards', old]);
            assert.equal(r.code, 0, r.out);
            assert.match(r.out, why);
            const card = JSON.parse(readFileSync(join(old, 'trigger.latest.json'), 'utf8'));
            assert.deepEqual(Object.keys(card.buckets).sort(), ['handoff/should', 'handoff/should-not'], 'nothing carried over from the old card');
        }
    });
    test('a run that never started is an error, not a verdict, and leaves the scorecard alone', () => {
        const broken = join(dir, 'broken.mjs');
        writeFileSync(broken, 'process.stderr.write("usage limit reached"); process.exit(1);');
        const before = readFileSync(join(cards, 'trigger.latest.json'), 'utf8');
        const r = runCli(['eval-routing', '--suite', 'trigger', '--skill', 'handoff', '--only', 't05', '--cmd', JSON.stringify([process.execPath, broken, '{prompt}']), '--save', '--scorecards', cards]);
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /ERROR\s+handoff\/t05 -/);
        assert.match(r.out, /1 run\(s\) errored and were not scored — no output \(exit 1\): usage limit reached/);
        assert.equal(readFileSync(join(cards, 'trigger.latest.json'), 'utf8'), before, 'an errored run must not overwrite a bucket');
    });
    test('evals: no baseline is a hint; --promote accepts; a regression beyond noise fails --check', () => {
        const cardsDir = tempDir('as-cards-');
        const write = (buckets) => writeFileSync(join(cardsDir, 'trigger.latest.json'), JSON.stringify({ suite: 'trigger', model: 'fake-model', date: '2026-09-29', runs: 1, buckets }));
        write({ 'a/should': { passed: 10, total: 10 }, 'a/should-not': { passed: 10, total: 10 } });
        let r = runCli(['evals', '--scorecards', cardsDir, '--check']);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /trigger\s+20\s+100%\s+—\s+fake-model\s+2026-09-29\s+no baseline — accept with --promote/);
        assert.match(r.out, /Sessions/);
        r = runCli(['evals', '--scorecards', cardsDir, '--promote']);
        assert.equal(r.code, 0, r.out);
        assert.ok(existsSync(join(cardsDir, 'trigger.baseline.json')));
        assert.equal(existsSync(join(cardsDir, 'trigger.latest.json')), false, 'promote moves the file: one copy');
        r = runCli(['evals', '--scorecards', cardsDir, '--check']);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /trigger\s+20\s+100%\s+100%.*baseline \(nothing newer\)/);
        write({ 'a/should': { passed: 9, total: 10 }, 'a/should-not': { passed: 10, total: 10 } });
        r = runCli(['evals', '--scorecards', cardsDir, '--check']);
        assert.equal(r.code, 0, `one flip in ten is noise: ${r.out}`);
        assert.match(r.out, /ok \(1 within noise\)/);
        write({ 'a/should': { passed: 2, total: 10 }, 'a/should-not': { passed: 10, total: 10 } });
        r = runCli(['evals', '--scorecards', cardsDir, '--check']);
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /REGRESSION \(1\)/);
        assert.match(r.out, /a\/should: 100\.0% → 20\.0%/);
        assert.match(r.out, /trigger: weakest — a\/should 2\/10/);
    });
    test('evals: a baseline of another method or model is reported as not comparable, never as a regression', () => {
        const cardsDir = tempDir('as-cards-');
        const card = (stamp, passed) => JSON.stringify({ suite: 'trigger', model: 'fake-model', ...stamp, date: '2026-10-05', runs: 1, buckets: { 'a/should': { passed, total: 10 } } });
        writeFileSync(join(cardsDir, 'trigger.baseline.json'), card({}, 10));
        writeFileSync(join(cardsDir, 'trigger.latest.json'), card({ method: EVAL_METHOD }, 2));
        let r = runCli(['evals', '--scorecards', cardsDir, '--check']);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /not comparable — see below/);
        assert.match(r.out, /trigger: baseline measured with method unstamped, this one with \d+ — not compared; review the latest, then accept it with --promote/);
        assert.doesNotMatch(r.out, /REGRESSION/);
        writeFileSync(join(cardsDir, 'trigger.baseline.json'), card({ method: EVAL_METHOD, model: 'older-model' }, 10));
        r = runCli(['evals', '--scorecards', cardsDir, '--check']);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /trigger: baseline measured on older-model, this one on fake-model — not compared/);
        writeFileSync(join(cardsDir, 'trigger.baseline.json'), card({ method: EVAL_METHOD }, 10));
        r = runCli(['evals', '--scorecards', cardsDir, '--check']);
        assert.equal(r.code, 1, `same method and model: compared and gated — ${r.out}`);
        assert.match(r.out, /REGRESSION \(1\)/);
    });
    test('evals --project: the session rows of one project, without the kit scorecards', () => {
        const repo = makeRepo();
        mkdirSync(join(repo, '.agents', 'learnings'), { recursive: true });
        const row = { v: 1, session_id: 's', window: 0, prompts: 3, corrections: 0, tokens: { input: 0, output: 1000, cache_read: 50000, cache_create: 5000, tool_results: 1000 }, tools: { calls: 4, failed: 0 }, verification: { edited: true, after_last_edit: true, passed: true }, claims: { unverified: false }, waste: { tokens: 0 }, heavy: { carried: 0 } };
        writeFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), `${JSON.stringify(row)}\n`);
        const r = runCli(['evals', '--project', repo]);
        assert.equal(r.code, 0, r.out);
        assert.doesNotMatch(r.out, /Kit evals/);
        assert.match(r.out, /1 context window\(s\)/);
        assert.match(r.out, /code checked after its last edit\s+100%/);
        assert.match(r.out, /cache hit rate\s+91%/);
    });
    test('a usage limit stops the run instead of feeding it the rest of the queue; --max-runs caps the runs', () => {
        const limited = join(dir, 'limited.mjs');
        writeFileSync(limited, [
            'const fs = require("node:fs");',
            `fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, "x");`,
            'console.log(JSON.stringify({ type: "system", subtype: "init", model: "fake-model" }));',
            'console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "You\'ve hit your session limit · resets 8pm" }));',
        ].join('\n'));
        const cjs = limited.replace(/\.mjs$/, '.cjs');
        writeFileSync(cjs, readFileSync(limited, 'utf8'));
        const r = runCli(['eval-routing', '--suite', 'trigger', '--skill', 'handoff', '--jobs', '1', '--cmd', JSON.stringify([process.execPath, cjs, '{prompt}'])]);
        assert.equal(r.code, 1, r.out);
        assert.equal(readFileSync(join(dir, 'calls.log'), 'utf8').length, 1, 'one run, then stop');
        assert.match(r.out, /7 trial\(s\) not run — stopped at a usage limit/);
        const capped = runCli(['eval-routing', '--suite', 'trigger', '--skill', 'handoff', '--max-runs', '3', '--cmd', smart]);
        assert.equal(capped.code, 1, capped.out);
        assert.match(capped.out, /3\/3 trials passed/);
        assert.match(capped.out, /5 trial\(s\) not run — --max-runs 3/);
    });
    test('an unknown suite is a usage error', () => {
        const r = runCli(['eval-routing', '--suite', 'nope']);
        assert.equal(r.code, 1);
        assert.match(r.out, /--suite must be routing, trigger or all/);
    });
});
// ---------------------------------------------------------------------------
// Model tiers: the agents of tools that read their own format, and the usage report
// ---------------------------------------------------------------------------
describe('model tiers in projects', () => {
    test('the codex target writes each agent as a Codex custom agent on its tier, and update and uninstall keep it exact', () => {
        const repo = makeRepo();
        const r = runCli(['install', repo, '--targets', 'codex', '--profile', 'standard']);
        assert.equal(r.code, 0, r.out);
        assert.ok(existsSync(join(repo, '.agents', 'models.json')), 'the tiers and prices travel with the kit');
        const scout = read(join(repo, '.codex', 'agents', 'scout.toml'));
        assert.match(scout, /^name = "scout"$/m);
        assert.match(scout, /^model = "gpt-6-luna"$/m);
        assert.match(scout, /^model_reasoning_effort = "high"$/m);
        assert.match(scout, /^sandbox_mode = "read-only"$/m, 'an agent that never writes runs read-only');
        assert.match(scout, /^developer_instructions = '''\nYou are a scout\./m);
        const impl = read(join(repo, '.codex', 'agents', 'implementer.toml'));
        assert.match(impl, /^model = "gpt-6\.1-sol"$/m);
        assert.match(impl, /^model_reasoning_effort = "medium"$/m);
        assert.doesNotMatch(impl, /sandbox_mode/, 'an agent that writes keeps the session sandbox');
        assert.match(read(join(repo, '.codex', 'agents', 'security-reviewer.toml')), /Your procedure is in `\.agents\/skills\/security\/SKILL\.md`/);
        assert.ok(manifest(repo).files['.codex/agents/scout.toml'], 'recorded by hash like every kit file');
        const agentsMd = read(join(repo, 'AGENTS.md'));
        assert.match(agentsMd, /\| Tier \| Use it for \| OpenAI \|/, 'Codex alone: only its provider');
        // The project runs its low tier on another model: update writes it into the agent.
        const cfgPath = join(repo, '.agents', 'sdlc.config.json');
        const cfg = json(cfgPath);
        cfg.models = { tiers: { openai: { low: { model: 'gpt-6-sol', effort: 'low' } } } };
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
        assert.equal(runCli(['update', repo]).code, 0);
        assert.match(read(join(repo, '.codex', 'agents', 'scout.toml')), /^model = "gpt-6-sol"$/m);
        assert.match(read(join(repo, '.codex', 'agents', 'scout.toml')), /^model_reasoning_effort = "low"$/m);
        assert.match(read(join(repo, 'AGENTS.md')), /\| low \| [^|]+ \| `gpt-6-sol` · low \|/);
        assert.equal(runCli(['uninstall', repo]).code, 0);
        assert.equal(existsSync(join(repo, '.codex', 'agents', 'scout.toml')), false);
        assert.equal(existsSync(join(repo, '.agents', 'models.json')), false);
    });
    test("a project's own Codex agent of the same name wins, and a locally edited kit one is kept", () => {
        const repo = makeRepo();
        mkdirSync(join(repo, '.codex', 'agents'), { recursive: true });
        writeFileSync(join(repo, '.codex', 'agents', 'scout.toml'), 'name = "scout"\ndescription = "ours"\ndeveloper_instructions = "ours"\n');
        const r = runCli(['install', repo, '--targets', 'codex', '--profile', 'minimal']);
        assert.match(r.out, /\.codex\/agents\/scout\.toml is the project's own/);
        assert.match(read(join(repo, '.codex', 'agents', 'scout.toml')), /description = "ours"/);
        assert.equal(manifest(repo).files['.codex/agents/scout.toml'], undefined);
        const planner = join(repo, '.codex', 'agents', 'planner.toml');
        writeFileSync(planner, `${read(planner)}# our note\n`);
        runCli(['update', repo, '--profile', 'standard']);
        assert.match(read(planner), /# our note/, 'a modified kit file is never overwritten');
    });
});
describe('agent-setup usage', () => {
    const dir = tempDir('as-usage-');
    const transcript = join(dir, 's1.jsonl');
    const line = (v) => JSON.stringify(v);
    writeFileSync(transcript, [
        line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'Where are invoices listed?' }, timestamp: '2026-10-01T10:00:00Z' }),
        line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'scout', prompt: 'map it' } }] } }),
        line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'src/billing.mjs:3' }] }, toolUseResult: { status: 'completed', agentId: 'x1', agentType: 'scout', resolvedModel: 'claude-haiku-5-5' } }),
        line({ type: 'cost-state', totalCostUSD: 0.0213 }),
    ].join('\n'));
    mkdirSync(join(dir, 's1', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 's1', 'subagents', 'agent-x1.jsonl'), line({ type: 'assistant', message: { id: 's1', model: 'claude-haiku-5-5', usage: { input_tokens: 30000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: 'map' }] } }));
    test('prices one transcript with its subagents, and sets it against the main model', () => {
        const r = runCli(['usage', '--transcript', transcript]);
        assert.equal(r.code, 0, r.out);
        // opus: 10 × $4 + 1000 × $20 = $0.02004; haiku: 30000 × $0.10 + 2000 × $0.50 = $0.004 → $0.024
        assert.match(r.out, /high\s+claude-opus-5-5\s+1\s/);
        assert.match(r.out, /low\s+claude-haiku-5-5\s+1\s/);
        assert.match(r.out, /total\s+\$0\.024/);
        assert.match(r.out, /Claude Code's own figure for the session: \$0\.021/);
        assert.match(r.out, /delegated down\s+scout 1: \$0\.004, on the main model \$0\.160 — up to \$0\.156 saved/);
        const j = JSON.parse(runCli(['usage', '--transcript', transcript, '--json', '--vs', 'low']).stdout);
        assert.equal(j.reference.name, 'low');
        assert.ok(j.reference.cost < j.total, 'everything on the low tier would have cost less');
    });
    test("reads a project's recorded windows, and leaves a baseline's out", () => {
        const repo = makeRepo({ learnings: true });
        const row = (setup) => line({ v: 1, session_id: setup, window: 0, recorded_at: '2026-10-02T10:00:00Z', setup: { kit: '2.0.0', mode: setup }, models: { 'claude-sonnet-5-5': { input: 0, output: 1e6, cache_read: 0, cache_create: 0, calls: 3 } } });
        writeFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), `${row('full')}\n${row('measure')}\n`);
        const r = runCli(['usage', repo]);
        assert.equal(r.code, 0, r.out);
        assert.match(r.out, /Model usage · 1 window/);
        assert.match(r.out, /total\s+\$10\.00/);
        assert.match(r.out, /1 baseline window\(s\) left out/);
        assert.match(r.out, /no subagent runs recorded/);
    });
    test('a session that cannot be found is an error, not an empty report', () => {
        const r = runCli(['usage', makeRepo(), '--session', 'current']);
        assert.equal(r.code, 1);
        assert.match(r.out, /no live session recorded/);
    });
});
describe('--session-model: the model Claude Code sessions start on', () => {
    const settings = (repo) => json(join(repo, '.claude', 'settings.json'));
    test('set on install, kept on update, removed with none; never one the project chose', () => {
        const repo = makeRepo();
        const r = runCli(['install', repo, '--targets', 'claude', '--session-model', 'opusplan']);
        assert.equal(r.code, 0, r.out);
        assert.equal(settings(repo).model, 'opusplan');
        assert.equal(manifest(repo).selection.sessionModel, 'opusplan');
        assert.equal(runCli(['update', repo]).code, 0);
        assert.equal(settings(repo).model, 'opusplan', 'an update keeps it');
        runCli(['update', repo, '--session-model', 'none']);
        assert.equal(settings(repo).model, undefined);
        const own = makeRepo();
        mkdirSync(join(own, '.claude'), { recursive: true });
        writeFileSync(join(own, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' }));
        const o = runCli(['install', own, '--targets', 'claude', '--session-model', 'opusplan', '--verbose']);
        assert.equal(settings(own).model, 'sonnet', "the project's own choice stays");
        assert.match(o.out, /already choose "sonnet"/);
        runCli(['uninstall', own]);
        assert.equal(settings(own).model, 'sonnet', 'uninstall takes out only what the kit set');
    });
    test('deleted by hand, it stays deleted; changed by hand, the change stays', () => {
        const repo = makeRepo();
        runCli(['install', repo, '--targets', 'claude', '--session-model', 'sonnet']);
        const file = join(repo, '.claude', 'settings.json');
        const s = settings(repo);
        delete s.model;
        writeFileSync(file, JSON.stringify(s, null, 2));
        runCli(['update', repo]);
        assert.equal(settings(repo).model, undefined, 'a removed model is not put back');
        runCli(['update', repo, '--session-model', 'opusplan']);
        assert.equal(settings(repo).model, 'opusplan', 'naming one again sets it');
        writeFileSync(file, JSON.stringify({ ...settings(repo), model: 'opus' }, null, 2));
        runCli(['uninstall', repo]);
        assert.equal(existsSync(file) ? settings(repo).model : 'opus', 'opus', 'a model changed by hand is not the kit\'s to remove');
    });
    test('an unknown model is refused; the install offers it when none is set', () => {
        const repo = makeRepo();
        const bad = runCli(['install', repo, '--targets', 'claude', '--session-model', 'gpt-5']);
        assert.equal(bad.code, 1);
        assert.match(bad.out, /--session-model must be a Claude Code model/);
        const ok = runCli(['install', makeRepo(), '--targets', 'claude']);
        assert.match(ok.out, /--session-model opusplan — sessions plan on Opus and build on Sonnet/);
    });
});
