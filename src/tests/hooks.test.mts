// Behavioural tests for the runtime hooks. Every case runs the real hook as a
// child process against a real temporary git repository.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runHook, guard, gitIn, cleanupTemp, tempDir, writeConfig, TWO_TRUNK, HOOKS } from './helpers.mjs';
import type { HookResult } from './helpers.mjs';
import {
  parseTranscript,
  windowSlice,
  windowFacts,
  claimsVerification,
  isCorrection,
  windowMetrics,
  compareWindows,
  summaryLine,
  summaryTable,
  costUnits,
  HEAVY_TOKENS,
} from '../kit/hooks/_transcript.mjs';
import { classifyPrompt, intakeFor, promptFacts, scorePrompt } from '../kit/hooks/_prompt.mjs';
import { costOf, mergeModels, normalizeModel, priceFor, readModels, tiersOf, usageLine, usageReport, usageText } from '../kit/hooks/_usage.mjs';
import type { ModelTable } from '../kit/hooks/_usage.mjs';

after(cleanupTemp);

// ---------------------------------------------------------------------------
describe('guard-git: production writes (two-trunk, on develop)', () => {
  const repo = makeRepo({ config: TWO_TRUNK });

  const denied = [
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin +feature:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin :main',
    'git push origin --delete main',
    'git push --all origin',
    'git checkout main && git merge develop',
    'git switch main; git merge --ff-only develop',
    'gh pr create --base main --title "release"',
    'gh pr create --title x --base=main',
    'bash -c "git push origin main"',
    'x=$(git push origin main)',
    'cd sub && git push origin main',
    'git -c core.pager=cat push origin main',
    'timeout 30 git push origin main',
    'GIT_TRACE=1 git push origin main',
  ];
  for (const cmd of denied) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd), `expected deny for: ${cmd}`));
  }

  test('denies the same command through the PowerShell tool', () => {
    assert.ok(guard(repo, 'git push origin main', 'PowerShell'));
    assert.ok(guard(repo, '& git push origin main', 'PowerShell'));
    assert.ok(guard(repo, 'pwsh -Command "git push origin main"', 'PowerShell'));
  });

  const allowed = [
    'git push origin feature/main-menu', // upstream false positive: \bmain\b matched inside main-menu
    'git push origin fix-main',
    'git push -u origin HEAD',
    'git push origin develop',
    'git push origin v1.2.0',
    'git log main..HEAD',
    'git diff main...HEAD --stat',
    'git fetch origin main',
    'git show main:README.md',
    'git checkout main',
    'git merge main',
    'git branch --show-current',
    'gh pr create --base develop --title x',
    'git commit -m "docs: never git push origin main"',
    "echo 'git push origin main' | node hook.mjs",
    'printf "%s" "git push origin main"',
  ];
  for (const cmd of allowed) {
    test(`allows: ${cmd}`, () => assert.equal(guard(repo, cmd), null, `unexpected deny for: ${cmd}`));
  }

  test('allows heredoc bodies that mention a production push', () => {
    const cmd = "cat > notes.md <<'EOF'\nnever run git push origin main\nEOF";
    assert.equal(guard(repo, cmd), null);
  });

  test('allows PowerShell here-string bodies that mention a production push', () => {
    const cmd = "$s = @'\ngit push origin main\n'@\nSet-Content notes.md $s";
    assert.equal(guard(repo, cmd, 'PowerShell'), null);
  });

  test('ignores non-shell tools and garbage payloads', () => {
    const r1 = runHook('guard-git.mjs', { tool_name: 'Read', tool_input: { file_path: 'x' } }, { cwd: repo });
    assert.equal(r1.code, 0);
    assert.equal(r1.stdout, '');
    const r2 = runHook('guard-git.mjs', 'not json at all', { cwd: repo });
    assert.equal(r2.code, 0);
    assert.equal(r2.stdout, '');
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: branching from production', () => {
  const repo = makeRepo({ config: TWO_TRUNK });

  for (const cmd of [
    'git checkout -b feature/x main',
    'git checkout -b feature/x origin/main',
    'git switch -c feature/x main',
    'git branch feature/x main',
    'git worktree add -b feature/x ../wt main',
  ]) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }

  test('allows cutting from integration', () => {
    assert.equal(guard(repo, 'git checkout -b feature/x develop'), null);
    assert.equal(guard(repo, 'git switch -c feature/x'), null); // standing on develop
  });

  test('denies an implicit cut while standing on production', () => {
    const onMain = makeRepo({ branch: 'main', config: TWO_TRUNK });
    const reason = guard(onMain, 'git checkout -b feature/x');
    assert.ok(reason);
    assert.match(reason, /standing on 'main'/);
  });

  test('resolves git aliases', () => {
    const r = makeRepo({ config: TWO_TRUNK });
    gitIn(r, 'config', 'alias.co', 'checkout');
    assert.ok(guard(r, 'git co -b feature/x main'));
  });

  test('gitflow allows hotfix branches from production', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, model: 'gitflow' } } });
    assert.equal(guard(r, 'git checkout -b hotfix/1.0.1 main'), null);
    assert.ok(guard(r, 'git checkout -b feature/y main'));
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: standing on production', () => {
  const repo = makeRepo({ branch: 'main', config: TWO_TRUNK });

  test('denies a bare push from production', () => assert.match(guard(repo, 'git push')!, /bare `git push`/));
  test('denies commit on production', () => assert.ok(guard(repo, 'git commit -m "x"')));
  test('denies merge on production', () => assert.ok(guard(repo, 'git merge develop')));
  test('denies pulling another branch into production', () => assert.ok(guard(repo, 'git pull origin develop')));
  test('allows a plain pull on production', () => assert.equal(guard(repo, 'git pull'), null));
  test('allows read-only commands', () => {
    assert.equal(guard(repo, 'git status'), null);
    assert.equal(guard(repo, 'git log --oneline -5'), null);
  });
  test('allows switching away', () => assert.equal(guard(repo, 'git switch develop'), null));
  test('allows committing after switching away in the same command', () =>
    assert.equal(guard(repo, 'git switch develop && git commit -m "x"'), null));
});

// ---------------------------------------------------------------------------
describe('guard-git: integration branch safety', () => {
  const repo = makeRepo({ config: TWO_TRUNK });
  test('denies force-push to integration', () => {
    assert.ok(guard(repo, 'git push --force origin develop'));
    assert.ok(guard(repo, 'git push -f origin develop'));
    assert.ok(guard(repo, 'git push origin +develop'));
  });
  test('allows force-with-lease on a feature branch', () =>
    assert.equal(guard(repo, 'git push --force-with-lease origin feature/x'), null));
  test('denies deleting shared branches', () => {
    assert.ok(guard(repo, 'git branch -D develop'));
    assert.ok(guard(repo, 'git branch -d main'));
  });
  test('allows deleting a feature branch', () => assert.equal(guard(repo, 'git branch -D feature/old'), null));
});

// ---------------------------------------------------------------------------
describe('guard-git: discarding uncommitted work', () => {
  const repo = makeRepo({ config: TWO_TRUNK });
  writeFileSync(join(repo, 'README.md'), '# changed by the user\n');

  for (const cmd of ['git reset --hard', 'git reset --hard origin/develop', 'git checkout -- .', 'git checkout .', 'git restore .', 'git restore -- .']) {
    test(`denies on a dirty tree: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }
  test('allows unstaging', () => assert.equal(guard(repo, 'git restore --staged .'), null));
  test('allows restoring one explicit file', () => assert.equal(guard(repo, 'git restore README.md'), null));

  test('allows reset --hard on a clean tree', () => {
    const clean = makeRepo({ config: TWO_TRUNK });
    assert.equal(guard(clean, 'git reset --hard'), null);
  });

  test('git clean', () => {
    const r = makeRepo({ config: TWO_TRUNK });
    writeFileSync(join(r, 'new-work.txt'), 'untracked\n');
    assert.ok(guard(r, 'git clean -fd'));
    assert.ok(guard(r, 'git clean -fdx'));
    assert.equal(guard(r, 'git clean -n'), null);
    assert.equal(guard(r, 'git clean -nd'), null);
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: shared tree', () => {
  const repo = makeRepo({ config: { ...TWO_TRUNK, sharedTree: true } });
  for (const cmd of ['git add -A', 'git add .', 'git add --all', 'git add -u', 'git commit -am "x"', 'git commit --all -m x', 'git stash']) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }
  for (const cmd of ['git add src/a.ts src/b.ts', 'git add -u src/', 'git commit -m "x"', 'git stash push -- src/a.ts', 'git stash list', 'git stash pop']) {
    test(`allows: ${cmd}`, () => assert.equal(guard(repo, cmd), null));
  }
  test('broad staging is allowed on a solo tree', () => {
    const solo = makeRepo({ config: TWO_TRUNK });
    assert.equal(guard(solo, 'git add -A'), null);
    assert.equal(guard(solo, 'git stash'), null);
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: model and config variations', () => {
  test('trunk: commit on main allowed, push to main denied, a pull request into main allowed', () => {
    const r = makeRepo({ branch: 'main', branches: [], config: { version: 1, branching: { model: 'trunk', production: 'main' }, gates: [] } });
    assert.equal(guard(r, 'git commit -m "fix: typo"'), null);
    assert.ok(guard(r, 'git push origin main'));
    assert.ok(guard(r, 'git push'));
    assert.equal(guard(r, 'gh pr create --base main --title x'), null, 'on a trunk, a pull request into it is the normal path');
  });

  test('releaseOnRequestOnly: false lets production move', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, releaseOnRequestOnly: false } } });
    assert.equal(guard(r, 'git push origin main'), null);
  });

  test('protectedRefs globs', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, protectedRefs: ['release/*'] } } });
    assert.ok(guard(r, 'git push origin release/2.0'));
    assert.equal(guard(r, 'git push origin feature/release-notes'), null);
  });

  test('extraDeny from the config', () => {
    const r = makeRepo({
      config: { ...TWO_TRUNK, guard: { extraDeny: [{ pattern: 'npm\\s+publish', reason: 'Publishing is manual.', instead: 'ask the user' }] } },
    });
    const reason = guard(r, 'npm publish --access public');
    assert.match(reason!, /Publishing is manual/);
    assert.match(reason!, /Instead: ask the user/);
  });

  test('works with no config at all (defaults: main/develop)', () => {
    const r = makeRepo();
    assert.ok(guard(r, 'git push origin main'));
  });

  test('tolerates a BOM-prefixed, PowerShell-written config', () => {
    const r = makeRepo();
    mkdirSync(join(r, '.agents'), { recursive: true });
    writeFileSync(join(r, '.agents', 'sdlc.config.json'), '\uFEFF' + JSON.stringify({ ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, production: 'prod' } }));
    gitIn(r, 'branch', 'prod');
    assert.ok(guard(r, 'git push origin prod'));
    assert.equal(guard(r, 'git push origin main'), null);
  });
});

describe('guard-git: a pull request per task', () => {
  const PER_TASK = { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, featurePrefix: 'feat/' }, workflow: { pullRequests: 'per-task' } };

  test('nothing is committed on, or pushed to, the integration branch; the denial names the branch to cut', () => {
    const repo = makeRepo({ config: PER_TASK });
    const commit = guard(repo, 'git commit -m "fix: typo"');
    assert.match(commit!, /runs every change as its own pull request \(workflow\.pullRequests: per-task\), so nothing is committed on 'develop' directly/);
    assert.match(commit!, /Instead: `git switch -c feat\/<short-name>` — your uncommitted changes come with you/);
    assert.match(guard(repo, 'git push')!, /only through a pull request[\s\S]*bare `git push` from 'develop' pushes 'develop'/);
    assert.ok(guard(repo, 'git push origin develop'));
  });

  test('a feature branch works as usual, including one cut in the same command', () => {
    const repo = makeRepo({ config: PER_TASK });
    assert.equal(guard(repo, 'git switch -c feat/x && git commit -m "feat: x"'), null);
    gitIn(repo, 'checkout', '-q', '-b', 'feat/y');
    for (const cmd of ['git commit --allow-empty -m "chore: start y"', 'git push -u origin HEAD', 'gh pr create --draft --base develop --title y', 'gh pr merge 7 --squash --delete-branch', 'git branch -D feat/x']) {
      assert.equal(guard(repo, cmd), null, cmd);
    }
  });

  test('trunk: the trunk is the branch nothing is committed on, even where production may move', () => {
    const r = makeRepo({ branch: 'main', branches: [], config: { version: 1, branching: { model: 'trunk', production: 'main', releaseOnRequestOnly: false }, workflow: { pullRequests: 'per-task' }, gates: [] } });
    assert.match(guard(r, 'git commit -m "fix: typo"')!, /nothing is committed on 'main' directly/);
    assert.match(guard(r, 'git push origin main')!, /only through a pull request/);
    assert.equal(guard(r, 'gh pr create --draft --base main --title x'), null);
  });

  test('off by default: commits and pushes on the integration branch pass, as before', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    assert.equal(guard(repo, 'git commit -m "fix: typo"'), null);
    assert.equal(guard(repo, 'git push origin develop'), null);
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: bypassing hooks', () => {
  const repo = makeRepo({ config: TWO_TRUNK });
  for (const cmd of [
    'git commit --no-verify -m "x"',
    'git commit -n -m "x"',
    'git push --no-verify origin feature/x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath .nothing',
    'git config --global core.hooksPath /dev/null',
    'git config --unset core.hooksPath',
    'git config set core.hooksPath .nothing',
    'git config unset core.hooksPath',
    'HUSKY=0 git commit -m x',
    'SKIP_HOOKS=1 git commit -m x',
    'gh pr merge 12 --admin --squash',
    'gh pr merge 12 --squash --admin=true',
  ]) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }
  test('PowerShell env assignment is caught too', () => {
    assert.ok(guard(repo, '$env:HUSKY = "0"; git commit -m x', 'PowerShell'));
  });
  test('allowed when the config opts out', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, guard: { denyNoVerify: false } } });
    assert.equal(guard(r, 'git commit --no-verify -m "x"'), null);
    assert.equal(guard(r, 'gh pr merge 12 --admin'), null);
  });
  test('a merge through the branch protection passes, and the --admin denial names the way through it', () => {
    for (const cmd of ['gh pr merge 12 --squash --delete-branch', 'gh pr merge --auto --squash --delete-branch', 'gh pr checks 12 --watch', 'gh pr merge 12 --squash --admin=false']) {
      assert.equal(guard(repo, cmd), null, cmd);
    }
    assert.match(guard(repo, 'gh pr merge 12 --admin')!, /merges past the branch protection[\s\S]*Instead: wait for the checks \(`gh pr checks --watch`\)/);
  });
  test('reading core.hooksPath is not changing it', () => {
    for (const cmd of ['git config --get core.hooksPath', 'git config core.hooksPath', 'git config --get-all core.hooksPath', 'git config get core.hooksPath', 'git config --show-origin --get core.hooksPath']) {
      assert.equal(guard(repo, cmd), null, cmd);
    }
  });
  test('ordinary flags that merely contain n are not mistaken for -n', () => {
    assert.equal(guard(repo, 'git commit --amend --no-edit'), null);
    assert.equal(guard(repo, 'git push -u origin feature/x'), null);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe('branch-check', () => {
  const ctx = (r: HookResult): string => r.json?.hookSpecificOutput?.additionalContext ?? '';

  test('silent on a healthy branch: the integration branch, or a feature branch that contains it', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '', 'the agent already gets the branch and status; guard-git holds the contract');
    gitIn(repo, 'checkout', '-q', '-b', 'feature/x');
    assert.equal(runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'resume' }, { cwd: repo }).stdout, '');
  });

  test('flags production, with the contract, exit 0, valid JSON', () => {
    const repo = makeRepo({ branch: 'main', config: TWO_TRUNK });
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'compact' }, { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json!.hookSpecificOutput!.hookEventName, 'SessionStart');
    assert.match(ctx(r), /^BRANCH CHECK/);
    assert.match(ctx(r), /PRODUCTION/);
    assert.match(ctx(r), /Every branch is cut from 'develop' and merges back into 'develop', never into 'main'/);
  });

  test('flags a stale feature branch', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    gitIn(repo, 'checkout', '-q', '-b', 'feature/x');
    gitIn(repo, 'checkout', '-q', 'develop');
    writeFileSync(join(repo, 'a.txt'), 'a');
    gitIn(repo, 'add', 'a.txt');
    gitIn(repo, 'commit', '-q', '-m', 'a');
    gitIn(repo, 'checkout', '-q', 'feature/x');
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'resume' }, { cwd: repo });
    assert.match(ctx(r), /0 ahead, 1 behind/);
    assert.match(ctx(r), /does NOT contain the tip/);
  });

  test("a fresh clone compares against origin/<branch>: silent while it contains it, speaks when behind, and only calls the config wrong when neither exists", () => {
    const origin = makeRepo({ config: TWO_TRUNK });
    gitIn(origin, 'branch', 'feature/x');
    const clone = join(tempDir('as-clone-'), 'teammate');
    gitIn(origin, 'clone', '-q', '--branch', 'feature/x', origin, clone);
    writeConfig(clone, TWO_TRUNK);
    const start = () => runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: clone });
    assert.equal(start().stdout, '', "develop is only origin/develop here, and feature/x contains it: nothing to say");
    writeFileSync(join(origin, 'a.txt'), 'a');
    gitIn(origin, 'add', 'a.txt');
    gitIn(origin, 'commit', '-q', '-m', 'a');
    gitIn(clone, 'fetch', '-q');
    assert.match(ctx(start()), /0 ahead, 1 behind 'origin\/develop'/);
    writeConfig(clone, { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, integration: 'dev' } });
    assert.match(ctx(start()), /Branch 'dev' exists neither locally nor as 'origin\/dev'/);
  });

  test('a branch whose remote branch is gone: its pull request was merged or closed, so new work does not start there', () => {
    const origin = makeRepo({ config: TWO_TRUNK });
    gitIn(origin, 'branch', 'feature/done');
    const clone = join(tempDir('as-clone-'), 'dev');
    gitIn(origin, 'clone', '-q', origin, clone);
    writeConfig(clone, TWO_TRUNK);
    gitIn(clone, 'checkout', '-q', 'feature/done');
    const start = () => runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: clone });
    assert.equal(start().stdout, '', 'a branch whose remote branch is still there: nothing to say');
    gitIn(origin, 'branch', '-D', 'feature/done');
    gitIn(clone, 'fetch', '-q', '--prune');
    const note = ctx(start());
    assert.match(note, /You are on 'feature\/done', whose branch on the remote is gone — its pull request was most likely merged or closed/);
    assert.match(note, /switch to 'develop' and pull\. Delete 'feature\/done' once `gh pr view feature\/done` shows it/);
  });

  test('handles detached HEAD', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    gitIn(repo, 'checkout', '-q', '--detach');
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    assert.match(ctx(r), /detached/);
  });

  test('the agent decides where to work, unless the team wants the question; a shared tree is said every time', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    assert.equal(runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo }).stdout, '', 'deciding needs no note');
    writeConfig(repo, { ...TWO_TRUNK, sharedTree: true });
    assert.match(ctx(runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo })), /worked on by more than one session at a time/);
    writeConfig(repo, { ...TWO_TRUNK, workflow: { askBranch: true } });
    const ask = ctx(runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo }));
    assert.match(ask, /ask the user whether to keep working on\n'develop' or cut a new branch from 'develop', and wait for the answer/);
  });

  test('a missing or provisional config is said to the person once, at startup; the agent hears of it only with something to act on', () => {
    const tip = (r: HookResult): string => String((r.json as { systemMessage?: string } | null)?.systemMessage ?? '');
    const none = makeRepo();
    const n = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: none });
    assert.equal(ctx(n), '', 'a healthy branch: nothing for the agent');
    assert.match(tip(n), /SDLC contract is missing — run \/sdlc-init once/);
    const prov = makeRepo({ config: { ...TWO_TRUNK, _provisional: true } });
    const p = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: prov });
    assert.match(tip(p), /provisional, with no gates yet/);
    assert.equal(runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'compact' }, { cwd: prov }).stdout, '', 'once, at startup');
    const onMain = makeRepo({ branch: 'main' });
    const m = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: onMain });
    assert.match(ctx(m), /PRODUCTION/);
    assert.match(ctx(m), /kit's DEFAULTS/);
    assert.doesNotMatch(ctx(m), /sdlc-init/, 'running it is the person\'s call, not something for the agent to bring up');
  });

  test('fails open on garbage and outside git', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    const g = runHook('branch-check.mjs', 'not json', { cwd: repo });
    assert.equal(g.code, 0);
    assert.ok(!g.json?.__unparseable);
    const plain = tempDir();
    const o = runHook('branch-check.mjs', { hook_event_name: 'SessionStart' }, { cwd: plain });
    assert.equal(o.code, 0);
    assert.equal(o.stdout, '');
  });
});

// ---------------------------------------------------------------------------
describe('run-hook: the same hooks in every other agent, each in its own words', () => {
  // The agent's payload in, the agent's answer out; the kit hook in between is the real one.
  const run = (repo: string, agent: string, hook: string, payload: unknown) => {
    const r = spawnSync(process.execPath, [join(HOOKS, 'run-hook.mjs'), agent, hook], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: '', CURSOR_PROJECT_DIR: '' },
      timeout: 20000,
    });
    assert.equal((r.stderr ?? '').trim(), '', `run-hook wrote to stderr: ${r.stderr}`);
    return { code: r.status, out: (r.stdout ?? '').trim(), json: (r.stdout ?? '').trim() ? JSON.parse(r.stdout) : null };
  };
  const repo = makeRepo({ config: { ...TWO_TRUNK, postEdit: [{ paths: ['src/**'], remind: 'RUN THE UNIT TESTS' }] } });

  test('a push to production is denied in each agent\'s own format', () => {
    const push = 'git push origin main';
    const codex = run(repo, 'codex', 'guard-git', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: push } }).json;
    assert.equal(codex.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(codex.hookSpecificOutput.permissionDecisionReason, /'main' is production/);
    const cursor = run(repo, 'cursor', 'guard-git', { command: push, cwd: repo }).json;
    assert.equal(cursor.permission, 'deny');
    assert.match(cursor.agent_message, /'main' is production/);
    const copilot = run(repo, 'copilot', 'guard-git', { toolName: 'bash', toolArgs: JSON.stringify({ command: push }), cwd: repo }).json;
    assert.equal(copilot.permissionDecision, 'deny');
    const antigravity = run(repo, 'antigravity', 'guard-git', { toolCall: { name: 'run_command', args: { CommandLine: push } } }).json;
    assert.equal(antigravity.decision, 'deny');
    const windsurf = spawnSync(process.execPath, [join(HOOKS, 'run-hook.mjs'), 'windsurf', 'guard-git'], {
      input: JSON.stringify({ tool_info: { command_line: push, cwd: repo } }),
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: '', CURSOR_PROJECT_DIR: '' },
    });
    assert.equal(windsurf.status, 2, 'Windsurf blocks on exit code 2');
    assert.match(windsurf.stderr, /'main' is production/, 'and shows stderr to the agent');
  });

  test('harmless commands and other tools pass in silence', () => {
    assert.equal(run(repo, 'cursor', 'guard-git', { command: 'git status' }).out, '');
    assert.equal(run(repo, 'copilot', 'guard-git', { toolName: 'view', toolArgs: { path: 'README.md' } }).out, '');
    assert.equal(run(repo, 'antigravity', 'guard-git', { toolCall: { name: 'view_file', args: {} } }).out, '');
    assert.equal(run(repo, 'codex', 'guard-git', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }).out, '');
  });

  test('an edit gets its post-edit check in Codex (every file a patch touches), Cursor and Copilot', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.js\n@@\n-x\n+y\n*** Add File: docs/b.md\n+z\n*** End Patch';
    const codex = run(repo, 'codex', 'check-gates', { hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: patch } }).json;
    assert.equal(codex.hookSpecificOutput.additionalContext, 'RUN THE UNIT TESTS', 'src/a.js matches; docs/b.md does not');
    assert.equal(run(repo, 'cursor', 'check-gates', { tool_name: 'Write', tool_input: { file_path: 'src/c.js' } }).json.additional_context, 'RUN THE UNIT TESTS');
    assert.equal(run(repo, 'copilot', 'check-gates', { toolName: 'edit', toolArgs: { path: 'src/d.js' } }).json.additionalContext, 'RUN THE UNIT TESTS');
    assert.equal(run(repo, 'cursor', 'check-gates', { tool_name: 'Write', tool_input: { file_path: 'README.md' } }).out, '', 'no check for that path');
  });

  test('the branch note at session start, only when the branch needs attention', () => {
    assert.equal(run(repo, 'cursor', 'branch-check', { session_id: 's' }).out, '', 'a healthy branch');
    const onMain = makeRepo({ branch: 'main', config: TWO_TRUNK });
    assert.match(run(onMain, 'cursor', 'branch-check', { session_id: 's' }).json.additional_context, /PRODUCTION/);
    assert.match(run(onMain, 'copilot', 'branch-check', { sessionId: 's', source: 'new' }).json.additionalContext, /PRODUCTION/);
  });

  test('the brief on a risky request, where the agent can take a note on a prompt (Codex)', () => {
    const note = run(repo, 'codex', 'prompt-intake', { hook_event_name: 'UserPromptSubmit', session_id: `rh-${process.pid}`, prompt: 'Add Stripe subscriptions with a billing page and webhooks for renewals' }).json;
    assert.match(note.hookSpecificOutput.additionalContext, /^INTAKE — It touches payments/);
  });

  test('fails open: an unknown agent or hook, or a payload that is not JSON', () => {
    for (const [agent, hook, payload] of [['nobody', 'guard-git', '{}'], ['cursor', 'nothing', '{}'], ['cursor', 'guard-git', 'not json']]) {
      const r = spawnSync(process.execPath, [join(HOOKS, 'run-hook.mjs'), agent, hook], { input: payload, cwd: repo, encoding: 'utf8' });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
    }
  });
});

// ---------------------------------------------------------------------------
describe('check-gates', () => {
  test('silent when nothing matches', () => {
    const repo = makeRepo({ config: { ...TWO_TRUNK, postEdit: [{ paths: ['src/**/*.ts'], remind: 'x' }] } });
    const r = runHook('check-gates.mjs', { tool_name: 'Edit', tool_input: { file_path: join(repo, 'docs', 'a.md') } }, { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });

  test('reminds and reports a failing check', () => {
    const repo = makeRepo({
      config: {
        ...TWO_TRUNK,
        postEdit: [
          { paths: ['src/**/*.{ts,tsx}'], remind: 'Regenerate the client.' },
          { paths: ['src/**'], run: 'node -e "process.exit(3)"', timeoutMs: 5000 },
        ],
      },
    });
    const r = runHook('check-gates.mjs', { tool_name: 'Write', tool_input: { file_path: join(repo, 'src', 'ui', 'a.tsx') } }, { cwd: repo });
    const text = r.json!.hookSpecificOutput!.additionalContext!;
    assert.match(text, /Regenerate the client/);
    assert.match(text, /GATE FAILED after editing src\/ui\/a.tsx/);
  });

  test('covers MultiEdit and NotebookEdit', () => {
    const repo = makeRepo({ config: { ...TWO_TRUNK, postEdit: [{ paths: ['**/*.ipynb'], remind: 'Clear outputs.' }] } });
    const r = runHook('check-gates.mjs', { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(repo, 'n', 'x.ipynb') } }, { cwd: repo });
    assert.match(r.json!.hookSpecificOutput!.additionalContext!, /Clear outputs/);
  });
});

// ---------------------------------------------------------------------------
describe('learning-signals', () => {
  const prompt = (repo: string, text: string): string | null =>
    runHook('learning-signals.mjs', { hook_event_name: 'UserPromptSubmit', prompt: text }, { cwd: repo }).json?.hookSpecificOutput
      ?.additionalContext ?? null;

  test('inert where the kit is not installed', () => {
    const repo = makeRepo();
    assert.equal(prompt(repo, 'I told you not to use npm'), null);
  });

  test('detects corrections in English and Portuguese', () => {
    const repo = makeRepo({ learnings: true });
    for (const t of [
      'I told you not to use npm here, this repo uses pnpm',
      "that's wrong, the handler lives in src/api",
      "don't use any in TypeScript",
      'Why did you delete the migration?',
      'from now on always run the typecheck before committing',
      'Remember to update the changelog',
      'já te disse para não usar npm',
      'não faças commits diretamente na main',
      'isso está errado, o ficheiro é outro',
      'a partir de agora usa sempre pnpm',
    ]) {
      assert.ok(prompt(repo, t), `expected a signal for: ${t}`);
    }
  });

  test('stays quiet on ordinary requests', () => {
    const repo = makeRepo({ learnings: true });
    for (const t of [
      'Please add a login page with email and password',
      "No worries, let's go with option B",
      'Can you explain how the router works?',
      'Fix the failing test in src/cart.test.ts',
      'Implementa a página de perfil do jogador',
      '```\n// don\'t use this\n```\nwhat does this snippet do?',
    ]) {
      assert.equal(prompt(repo, t), null, `unexpected signal for: ${t}`);
    }
  });

  test('says nothing at session start, even with lessons waiting: they are the admin\'s, through report', () => {
    const repo = makeRepo({ learnings: true });
    writeFileSync(join(repo, '.agents', 'learnings', 'inbox.md'), '# Inbox\n\n## 2026-09-26 — a\n- x\n\n## 2026-09-26 — b\n- y\n');
    const r = runHook('learning-signals.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });

  test('records the live-session pointer on session start', () => {
    const repo = makeRepo({ learnings: true });
    const r = runHook(
      'learning-signals.mjs',
      { hook_event_name: 'SessionStart', source: 'startup', session_id: 's-live', transcript_path: '/tmp/t.jsonl', cwd: repo },
      { cwd: repo },
    );
    assert.equal(r.code, 0);
    const pointer = JSON.parse(readFileSync(join(repo, '.agents', 'learnings', 'live-session.json'), 'utf8'));
    assert.equal(pointer.session_id, 's-live');
    assert.equal(pointer.transcript_path, '/tmp/t.jsonl');
    assert.ok(pointer.started_at);
  });

  test('the pointer records what the payload carries, silently', () => {
    const repo = makeRepo({ learnings: true });
    const r = runHook('learning-signals.mjs', { hook_event_name: 'SessionStart', source: 'startup', session_id: 's-partial' }, { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '', 'a sensor says nothing');
    const pointer = JSON.parse(readFileSync(join(repo, '.agents', 'learnings', 'live-session.json'), 'utf8'));
    assert.equal(pointer.session_id, 's-partial');
    assert.equal(pointer.transcript_path, null);
  });

  test('friction log: redacts secrets and flags the third identical failure', () => {
    const repo = makeRepo({ learnings: true });
    const fail = () =>
      runHook(
        'learning-signals.mjs',
        {
          hook_event_name: 'PostToolUseFailure',
          session_id: 's1',
          tool_name: 'Bash',
          tool_input: { command: 'curl -H "Authorization: Bearer abcdef1234567890SECRET" https://api.example.com' },
          tool_error: 'exit code 7',
        },
        { cwd: repo },
      );
    assert.equal(fail().stdout, '');
    assert.equal(fail().stdout, '');
    const third = fail();
    assert.match(third.json!.hookSpecificOutput!.additionalContext!, /failed 3 times/);
    const log = readFileSync(join(repo, '.agents', 'learnings', 'signals.jsonl'), 'utf8');
    assert.ok(!log.includes('abcdef1234567890SECRET'), 'secret leaked into the friction log');
    assert.equal(log.trim().split('\n').length, 3);
  });

  test('no friction log without the learnings directory', () => {
    const repo = makeRepo();
    runHook('learning-signals.mjs', { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' } }, { cwd: repo });
    assert.equal(existsSync(join(repo, '.agents', 'learnings', 'signals.jsonl')), false);
  });
});

// ---------------------------------------------------------------------------
// session-eval, and the transcript parser it shares with the CLI
// ---------------------------------------------------------------------------

type Line = Record<string, unknown>;
let msgSeq = 0;
const human = (text: string): Line => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text }, timestamp: '2026-09-29T10:00:00.000Z' });
const call = (blocks: unknown[], opts: { id?: string; usage?: Record<string, number> } = {}): Line => ({
  type: 'assistant',
  message: {
    id: opts.id ?? `msg-${++msgSeq}`,
    model: 'claude-sonnet-5',
    usage: opts.usage ?? { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 },
    content: blocks,
  },
});
const use = (id: string, name: string, input: Record<string, unknown>): Line => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: string, isError = false): Line => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] },
});
const reply = (text: string): Line => call([{ type: 'text', text }]);
const BOUNDARY: Line = { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } };
const SUMMARY: Line = { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' } };
const jsonl = (lines: Line[]): string => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

describe('transcript parser', () => {
  test('counts usage once per API call, however many lines the call spans', () => {
    const usage = { input_tokens: 5, output_tokens: 300, cache_read_input_tokens: 9000, cache_creation_input_tokens: 50 };
    const s = parseTranscript(
      jsonl([
        human('Fix the parser'),
        call([{ type: 'thinking', thinking: 'hm' }], { id: 'm1', usage }),
        call([{ type: 'text', text: 'Reading it.' }], { id: 'm1', usage }),
        call([use('t1', 'Read', { file_path: '/p/a.mjs' })], { id: 'm1', usage }),
      ]),
    );
    assert.equal(s.calls, 1);
    assert.equal(s.outputTokens, 300, 'Claude Code repeats usage on every line of one response');
    assert.equal(s.cacheRead, 9000);
    assert.equal(s.models['claude-sonnet-5'].calls, 1);
    assert.equal(s.tools.length, 1, "each line's content blocks still count");
  });

  test('only human messages are prompts', () => {
    const s = parseTranscript(
      jsonl([
        human('Add pagination'),
        { type: 'user', isMeta: true, message: { role: 'user', content: 'Base directory for this skill' } },
        { type: 'user', origin: { kind: 'peer' }, message: { role: 'user', content: 'Another Claude session says hi' } },
        { type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>done</task-notification>' } },
        SUMMARY,
        { type: 'user', message: { role: 'user', content: 'An older transcript with no origin' } },
      ]),
    );
    assert.deepEqual(s.prompts.map((p) => p.text), ['Add pagination', 'An older transcript with no origin']);
  });

  test('windowSlice returns the text after the last compaction, and its index', () => {
    const text = jsonl([
      human('first window'),
      BOUNDARY,
      SUMMARY,
      human('second window'),
      result('x', 'a tool result that mentions compact_boundary is not a boundary'),
      BOUNDARY,
      SUMMARY,
      human('third window'),
    ]);
    const w = windowSlice(text);
    assert.equal(w.index, 2);
    assert.deepEqual(parseTranscript(w.text).prompts.map((p) => p.text), ['third window']);
    assert.equal(windowSlice(jsonl([human('never compacted')])).index, 0);
  });

  test('a re-read with no edit in between is waste; a read after an edit is not', () => {
    const body = 'x'.repeat(4000); // 1000 estimated tokens
    const s = parseTranscript(
      jsonl([
        human('Tidy a.mjs'),
        call([use('r1', 'Read', { file_path: '/p/a.mjs' })]),
        result('r1', body),
        call([use('r2', 'Read', { file_path: '/p/a.mjs' })]),
        result('r2', body),
        call([use('e1', 'Edit', { file_path: '/p/a.mjs', old_string: 'a', new_string: 'b' })]),
        result('e1', 'ok'),
        call([use('r3', 'Read', { file_path: '/p/a.mjs' })]),
        result('r3', body),
        call([use('r4', 'Read', { file_path: '/p/a.mjs', offset: 10, limit: 5 })]),
        result('r4', 'another slice'),
        reply('Done.'),
      ]),
    );
    assert.deepEqual(s.tools.map((t) => t.redundant), [false, true, false, false, false]);
    const f = windowFacts(s, { root: '/p' });
    assert.equal(f.waste.redundant_reads, 1);
    assert.equal(f.waste.redundant_tokens, 1000);
    assert.equal(f.waste.carried, 1000 * 4, 'the re-read result was carried by the 4 calls after it');
    assert.deepEqual(f.files_changed, ['a.mjs']);
  });

  test('a failed edit changes no file', () => {
    const s = parseTranscript(jsonl([human('Edit it'), call([use('e1', 'Edit', { file_path: '/p/a.mjs' })]), result('e1', 'String not found', true)]));
    assert.deepEqual(s.filesChanged, []);
    assert.equal(windowFacts(s).verification.edited, false);
  });

  test('only code and config inside the project need a check after them', () => {
    const facts = (lastEdit: string) =>
      windowFacts(
        parseTranscript(
          jsonl([
            human('Fix it'),
            call([use('e1', 'Edit', { file_path: '/p/src/a.mjs' })]),
            result('e1', 'ok'),
            call([use('b1', 'Bash', { command: 'npm test' })]),
            result('b1', 'ok'),
            call([use('e2', 'Write', { file_path: lastEdit })]),
            result('e2', 'ok'),
            reply('Done, tests pass.'),
          ]),
        ),
        { root: '/p' },
      );
    for (const f of ['/p/CHANGELOG.md', '/home/me/.claude/memory/note.md', '/tmp/scratch/probe.mjs']) {
      assert.equal(facts(f).verification.after_last_edit, true, f);
      assert.equal(facts(f).claims.unverified, false, f);
    }
    assert.equal(facts('/p/src/b.mjs').verification.after_last_edit, false, 'code changed after the last check');
    assert.equal(facts('/p/src/b.mjs').claims.unverified, true);
  });

  test('verification after the last edit, and claims the transcript does not back', () => {
    const verified = windowFacts(
      parseTranscript(
        jsonl([
          human('Fix it'),
          call([use('e1', 'Edit', { file_path: '/p/a.mjs' })]),
          result('e1', 'ok'),
          call([use('b1', 'Bash', { command: 'cd /p && npm test 2>&1' })]),
          result('b1', 'ok 12 passed'),
          reply('Fixed. npm test: green, all tests pass.'),
        ]),
      ),
    );
    assert.deepEqual(verified.verification, { edited: true, after_last_edit: true, passed: true, commands: ['npm test'], last_edit: 0 });
    assert.deepEqual(verified.claims, { verified: true, unverified: false });

    const stale = windowFacts(
      parseTranscript(
        jsonl([
          human('Fix it'),
          call([use('b1', 'Bash', { command: 'npm test' })]),
          result('b1', 'ok'),
          call([use('e1', 'Edit', { file_path: '/p/a.mjs' })]),
          result('e1', 'ok'),
          reply('Fixed, and the tests pass.'),
        ]),
      ),
    );
    assert.equal(stale.verification.after_last_edit, false, 'the only check ran before the edit');
    assert.equal(stale.claims.unverified, true);

    const failing = windowFacts(
      parseTranscript(
        jsonl([
          human('Fix it'),
          call([use('e1', 'Edit', { file_path: '/p/a.mjs' })]),
          result('e1', 'ok'),
          call([use('b1', 'PowerShell', { command: 'npm run check' })]),
          result('b1', 'Exit code 1\n2 failing', true),
          reply('Done, verified.'),
        ]),
      ),
    );
    assert.equal(failing.verification.passed, false);
    assert.equal(failing.claims.unverified, true);

    const readOnly = windowFacts(parseTranscript(jsonl([human('Explain the parser'), reply('All tests pass on main.')])));
    assert.equal(readOnly.verification.after_last_edit, null);
    assert.equal(readOnly.claims.unverified, false, 'nothing changed, so nothing needed checking');
  });

  test('plans and denials are not claims of verification', () => {
    for (const t of ['Once the tests pass, merge it.', 'I have not verified this.', 'This is unverified.', "I haven't run it; tests should pass.", 'Next: make sure the build passes.']) {
      assert.equal(claimsVerification(t), false, t);
    }
    for (const t of ['Ran npm test to confirm: tests pass.', 'Build, lint and all 43 board tests pass.', 'lint: clean', 'Verified in the browser.', 'All green.']) {
      assert.equal(claimsVerification(t), true, t);
    }
  });

  test('a heavy result is reported with what the later calls paid for it, without command text', () => {
    const s = parseTranscript(
      jsonl([
        human('Why is the log so big?'),
        call([use('b1', 'Bash', { command: 'cat /p/server.log --token=abc123' })]),
        result('b1', 'y'.repeat(HEAVY_TOKENS * 4)),
        reply('Looking.'),
        reply('Found it.'),
      ]),
    );
    const f = windowFacts(s, { root: '/p' });
    assert.equal(f.heavy.count, 1);
    assert.deepEqual(f.heavy.top[0], { tool: 'Bash', target: 'cat', tokens: HEAVY_TOKENS, carried: HEAVY_TOKENS * 2 });
    assert.ok(!JSON.stringify(f).includes('abc123'), 'command text never reaches the facts');
  });
});

describe('session-eval', () => {
  const rows = (repo: string): Array<Record<string, any>> =>
    readFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, any>);

  test('records one silent row per window, and replaces it when the window is recorded again', () => {
    const repo = makeRepo({ learnings: true });
    const transcript = join(tempDir('as-transcript-'), 's-eval.jsonl');
    writeFileSync(
      transcript,
      jsonl([
        human('first window'),
        BOUNDARY,
        SUMMARY,
        human('Rotate the key: sk-live-SECRET123'),
        call([use('e1', 'Edit', { file_path: join(repo, 'src', 'a.mjs') })]),
        result('e1', 'ok'),
        reply('Done, tests pass.'),
      ]),
    );
    const pre = runHook('session-eval.mjs', { hook_event_name: 'PreCompact', trigger: 'manual', session_id: 's-eval', transcript_path: transcript }, { cwd: repo });
    assert.equal(pre.code, 0);
    assert.equal(pre.stdout, '', 'a sensor adds nothing to the context');
    let r = rows(repo);
    assert.equal(r.length, 1);
    assert.equal(r[0].session_id, 's-eval');
    assert.equal(r[0].window, 1);
    assert.equal(r[0].end, 'compact:manual');
    assert.equal(r[0].prompts, 1);
    assert.deepEqual(r[0].files_changed, ['src/a.mjs']);
    assert.equal(r[0].claims.unverified, true);

    runHook('session-eval.mjs', { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit', session_id: 's-eval', transcript_path: transcript }, { cwd: repo });
    r = rows(repo);
    assert.equal(r.length, 1, 'the same window is replaced, not duplicated');
    assert.equal(r[0].end, 'session:prompt_input_exit');
    assert.ok(!readFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), 'utf8').includes('SECRET123'), 'no prompt text in a row');
  });

  test('inert without the learnings folder; silent on other events, bad input and empty windows', () => {
    const transcript = join(tempDir('as-transcript-'), 't.jsonl');
    writeFileSync(transcript, jsonl([human('hi')]));
    const plain = makeRepo();
    runHook('session-eval.mjs', { hook_event_name: 'SessionEnd', session_id: 's', transcript_path: transcript }, { cwd: plain });
    assert.equal(existsSync(join(plain, '.agents', 'learnings')), false);

    const repo = makeRepo({ learnings: true });
    const empty = join(tempDir('as-transcript-'), 'empty.jsonl');
    writeFileSync(empty, jsonl([human('before'), BOUNDARY, SUMMARY]));
    for (const p of [
      { hook_event_name: 'UserPromptSubmit', prompt: 'x', transcript_path: transcript },
      { hook_event_name: 'SessionEnd', session_id: 's', transcript_path: join(repo, 'missing.jsonl') },
      { hook_event_name: 'PreCompact', session_id: 's' },
      { hook_event_name: 'PreCompact', session_id: 's', transcript_path: empty },
      'not json',
    ]) {
      const r = runHook('session-eval.mjs', p, { cwd: repo });
      assert.equal(r.code, 0);
      assert.equal(r.stdout, '');
    }
    assert.equal(existsSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl')), false);
  });

  test('shows the person one summary line at session start only when asked, never on a compaction, and prints the table by hand', () => {
    const repo = makeRepo({ learnings: true });
    const row = (over: Record<string, unknown>) => ({
      v: 1,
      session_id: 's',
      window: 0,
      prompts: 4,
      corrections: 1,
      tokens: { input: 100, output: 1000, cache_read: 90000, cache_create: 9000, tool_results: 2000 },
      tools: { calls: 10, failed: 1 },
      verification: { edited: true, after_last_edit: true, passed: true },
      claims: { unverified: false },
      waste: { tokens: 100 },
      heavy: { carried: 0 },
      ...over,
    });
    writeFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), `${[row({}), row({ verification: { edited: true, after_last_edit: false, passed: null } })].map((r) => JSON.stringify(r)).join('\n')}\n`);
    assert.equal(runHook('session-eval.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo }).stdout, '', 'off by default: the numbers are the admin\'s');
    writeFileSync(join(repo, '.agents', 'sdlc.config.json'), JSON.stringify({ workflow: { sessionSummary: true } }));
    const start = runHook('session-eval.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    const msg = JSON.parse(start.stdout) as { systemMessage?: string; hookSpecificOutput?: unknown };
    assert.match(msg.systemMessage!, /Evals, last 2 window\(s\): code checked after its last edit 50%/);
    assert.equal(msg.hookSpecificOutput, undefined, 'a systemMessage for the user, nothing for the model');
    assert.equal(runHook('session-eval.mjs', { hook_event_name: 'SessionStart', source: 'compact' }, { cwd: repo }).stdout, '');

    const table = spawnSync(process.execPath, [join(HOOKS, 'session-eval.mjs'), '--summary'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
    assert.equal(table.status, 0);
    assert.match(table.stdout, /code checked after its last edit\s+50%/);
    assert.match(table.stdout, /cost per window \(input-token equiv\.\)/);
  });
});

describe('corrections, checks and summary metrics', () => {
  test('a correction is read from what the user wrote, not the context an editor prepends', () => {
    assert.equal(isCorrection("that's wrong, use the other table"), true);
    assert.equal(isCorrection('<ide_opened_file>The user opened a.ts</ide_opened_file>\nwhy did you delete the test?'), true);
    assert.equal(isCorrection('<ide_selection>never use var</ide_selection>\nadd a button'), false);
    assert.equal(isCorrection('> never do this\nsummarise the quoted review'), false);
    assert.equal(isCorrection('add pagination to the users table'), false);
  });

  test('corrections are counted per window; gate-runner and configured gate commands count as checks', () => {
    const f = windowFacts(
      parseTranscript(
        jsonl([
          human('Add the endpoint'),
          call([use('e1', 'Edit', { file_path: '/p/src/a.mjs' })]),
          result('e1', 'ok'),
          human('no, that is wrong — I told you to keep the old route'),
          call([use('g1', 'Agent', { subagent_type: 'gate-runner', prompt: 'run the gates' })]),
          result('g1', 'BLOCKED — typecheck failed'),
        ]),
      ),
      { root: '/p' },
    );
    assert.equal(f.prompts, 2);
    assert.equal(f.corrections, 1);
    assert.deepEqual([f.verification.after_last_edit, f.verification.passed, f.verification.commands], [true, false, ['gate-runner']]);

    const custom = windowFacts(
      parseTranscript(jsonl([human('Fix it'), call([use('e1', 'Edit', { file_path: '/p/src/a.mjs' })]), result('e1', 'ok'), call([use('b1', 'Bash', { command: 'make verify-all' })]), result('b1', 'ok')])),
      { root: '/p', checks: ['make verify-all'] },
    );
    assert.deepEqual([custom.verification.after_last_edit, custom.verification.passed], [true, true]);
  });

  test('metrics summarise rows, compare the last windows with the ones before, and name the direction', () => {
    const row = (checked: boolean, cacheRead: number) => ({
      session_id: 's',
      prompts: 2,
      corrections: 0,
      tokens: { input: 0, output: 0, cache_read: cacheRead, cache_create: 0, tool_results: 0 },
      verification: { edited: true, after_last_edit: checked, passed: checked ? true : null },
      claims: { unverified: !checked },
      tools: { calls: 0, failed: 0 },
      waste: { tokens: 0 },
      heavy: { carried: 0 },
    });
    const rows = [row(false, 2e6), row(false, 2e6), row(true, 1e6), row(true, 1e6)];
    assert.equal(costUnits({ input: 10, cache_create: 100, cache_read: 1000, output: 20 }), 10 + 125 + 100 + 100);
    const m = windowMetrics(rows);
    assert.deepEqual([m.windows, m.checked, m.unverified], [4, 0.5, 0.5]);
    const cmp = compareWindows(rows, 2);
    const checked = cmp.rows.find((r) => r.key === 'checked')!;
    assert.deepEqual([checked.shown, checked.prevShown, checked.trend], ['100%', '0%', 'better']);
    assert.equal(cmp.rows.find((r) => r.key === 'cost')!.trend, 'better');
    assert.match(summaryLine(rows, 2), /^Evals, last 2 window\(s\): code checked after its last edit 100%/);
    assert.match(summaryTable([], 20), /No context windows recorded yet/);
  });
});

describe('stop-check', () => {
  let n = 0;
  const transcriptOf = (lines: Line[]): string => {
    const file = join(tempDir('as-stop-'), 't.jsonl');
    writeFileSync(file, jsonl(lines));
    return file;
  };
  const stop = (repo: string, transcript: string, extra: Record<string, unknown> = {}, session = `stop-${process.pid}-${++n}`) =>
    runHook('stop-check.mjs', { hook_event_name: 'Stop', session_id: session, transcript_path: transcript, ...extra }, { cwd: repo });
  const decision = (r: HookResult): { decision?: string; reason?: string } => (r.stdout ? (JSON.parse(r.stdout) as { decision?: string; reason?: string }) : {});

  test('blocks once when code changed after the last check, then lets the stop through', () => {
    const repo = makeRepo();
    const t = transcriptOf([
      human('Fix it'),
      call([use('b1', 'Bash', { command: 'npm test' })]),
      result('b1', 'ok'),
      call([use('e1', 'Edit', { file_path: join(repo, 'src', 'a.mjs') })]),
      result('e1', 'ok'),
    ]);
    const session = `stop-once-${process.pid}`;
    const first = decision(stop(repo, t, { last_assistant_message: 'Fixed, tests pass.' }, session));
    assert.equal(first.decision, 'block');
    assert.match(first.reason!, /Code changed after the last check \(src\/a\.mjs\)/);
    assert.match(first.reason!, /claims a verification the transcript does not show/);
    assert.match(first.reason!, /no gates are configured yet/);
    assert.equal(stop(repo, t, {}, session).stdout, '', 'the second stop for the same edit goes through');
  });

  test('risky work changed and checked, but never reviewed: asks once for the reviewer the project has', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'agents', 'security-reviewer.md'), '---\nname: security-reviewer\n---\n');
    const risky = 'Add an endpoint that exports an organisation\'s invoices as CSV, with tests';
    const lines = (after: Line[]): Line[] => [
      human(risky),
      call([use('e1', 'Edit', { file_path: join(repo, 'src', 'export.mjs') })]),
      result('e1', 'ok'),
      ...after,
      call([use('b1', 'Bash', { command: 'npm test' })]),
      result('b1', 'ok'),
    ];
    const session = `stop-review-${process.pid}`;
    const first = decision(stop(repo, transcriptOf(lines([])), {}, session));
    assert.equal(first.decision, 'block');
    assert.match(first.reason!, /^This change touches payments and no reviewer has looked at it: have the security-reviewer agent review the diff/);
    assert.equal(stop(repo, transcriptOf(lines([])), {}, session).stdout, '', 'once per edit');

    // A review, then a fix of its findings: reviewed, so no second review is asked for.
    const reviewed = lines([
      call([use('r1', 'Agent', { subagent_type: 'security-reviewer', prompt: 'review the diff' })]),
      result('r1', 'one high finding'),
      call([use('e2', 'Edit', { file_path: join(repo, 'src', 'export.mjs') })]),
      result('e2', 'ok'),
    ]);
    assert.equal(stop(repo, transcriptOf(reviewed)).stdout, '');

    // Unchecked and unreviewed: one block carries both asks.
    const both = decision(stop(repo, transcriptOf([human(risky), call([use('e1', 'Edit', { file_path: join(repo, 'src', 'export.mjs') })]), result('e1', 'ok')])));
    assert.match(both.reason!, /Code changed after the last check[\s\S]*have the security-reviewer agent review the diff/);

    // Ordinary work, or no reviewer installed: the check alone, as before.
    const plain = transcriptOf([human('Rename the date helper in src/util.mjs and update its callers'), call([use('e1', 'Edit', { file_path: join(repo, 'src', 'util.mjs') })]), result('e1', 'ok'), call([use('b1', 'Bash', { command: 'npm test' })]), result('b1', 'ok')]);
    assert.equal(stop(repo, plain).stdout, '');
    const bare = makeRepo();
    assert.equal(stop(bare, transcriptOf(lines([]))).stdout, '', 'nothing to name: no reviewer installed');
  });

  test('silent when the check ran after the edit, for prose, when disabled, and on an early run', () => {
    const repo = makeRepo();
    const checked = transcriptOf([human('Fix it'), call([use('e1', 'Edit', { file_path: join(repo, 'a.mjs') })]), result('e1', 'ok'), call([use('b1', 'Bash', { command: 'npm test' })]), result('b1', 'ok')]);
    assert.equal(stop(repo, checked).stdout, '');
    const prose = transcriptOf([human('Update the docs'), call([use('e1', 'Edit', { file_path: join(repo, 'README.md') })]), result('e1', 'ok')]);
    assert.equal(stop(repo, prose).stdout, '');
    const code = transcriptOf([human('Fix it'), call([use('e1', 'Edit', { file_path: join(repo, 'a.mjs') })]), result('e1', 'ok')]);
    assert.equal(stop(repo, code, { stop_hook_active: true }).stdout, '', 'an early (streaming) run cannot block');
    writeConfig(repo, { workflow: { verifyBeforeStop: false } });
    assert.equal(stop(repo, code).stdout, '');
  });

  test('a failed last check blocks with its own reason; a configured gate command counts as the check', () => {
    const repo = makeRepo({ config: { ...TWO_TRUNK, gates: [{ id: 'all', command: 'make verify-all' }] } });
    const failing = transcriptOf([
      human('Fix it'),
      call([use('e1', 'Edit', { file_path: join(repo, 'a.mjs') })]),
      result('e1', 'ok'),
      call([use('b1', 'Bash', { command: 'make verify-all' })]),
      result('b1', 'Exit code 2', true),
    ]);
    const d = decision(stop(repo, failing));
    assert.equal(d.decision, 'block');
    assert.match(d.reason!, /The last check after your latest edit failed \(make verify-all\)/);
    const passing = transcriptOf([human('Fix it'), call([use('e1', 'Edit', { file_path: join(repo, 'a.mjs') })]), result('e1', 'ok'), call([use('b1', 'Bash', { command: 'make verify-all' })]), result('b1', 'ok')]);
    assert.equal(stop(repo, passing).stdout, '');
  });

  test("a subagent's edits count as this thread's: the check and the review are asked for, its own check counts, a background run counts once finished", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'agents', 'security-reviewer.md'), '---\nname: security-reviewer\n---\n');
    const risky = 'Add a password reset to the login flow: a one-time token that expires after 15 minutes, with tests';
    // The main thread, and each subagent run's own transcript beside it.
    const session = (lines: Line[], runs: Record<string, Line[]>): string => {
      const t = transcriptOf(lines);
      const dir = join(t.replace(/\.jsonl$/, ''), 'subagents');
      mkdirSync(dir, { recursive: true });
      for (const [id, sub] of Object.entries(runs)) writeFileSync(join(dir, `agent-${id}.jsonl`), jsonl(sub));
      return t;
    };
    const ran = (id: string, agentId: string, background = false): Line => ({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: background ? 'Launched' : 'DONE' }] },
      toolUseResult: background ? { isAsync: true, status: 'async_launched', agentId } : { status: 'completed', agentId, agentType: 'implementer' },
    });
    const test = (id: string): Line[] => [call([use(id, 'Bash', { command: 'npm test' })]), result(id, 'ok')];
    const built: Line[] = [call([use('w1', 'Write', { file_path: join(repo, 'src', 'reset.mjs'), content: 'x' })]), result('w1', 'ok')];
    const delegated: Line[] = [human(risky), call([use('a1', 'Agent', { subagent_type: 'implementer', prompt: 'Step 1' })]), ran('a1', 'im1')];

    const both = decision(stop(repo, session(delegated, { im1: built })));
    assert.equal(both.decision, 'block', "the edits are in the implementer's transcript, not this one");
    assert.match(both.reason!, /Code changed after the last check \(src\/reset\.mjs\)[\s\S]*have the security-reviewer agent review the diff/);

    const tested = decision(stop(repo, session(delegated, { im1: [...built, ...test('b1')] })));
    assert.match(tested.reason!, /^This change touches auth and no reviewer has looked at it/, 'its own check after its last edit counts');
    const reviewed = [...delegated, call([use('r1', 'Agent', { subagent_type: 'security-reviewer', prompt: 'review the diff' })]), result('r1', 'no findings')];
    assert.equal(stop(repo, session(reviewed, { im1: [...built, ...test('b1')] })).stdout, '');

    const memory: Line[] = [call([use('w1', 'Write', { file_path: join(repo, '.claude', 'agent-memory', 'notes.md'), content: 'x' })]), result('w1', 'ok')];
    assert.equal(stop(repo, session(delegated, { im1: memory })).stdout, '', 'prose and agent memory are not code');
    const deep = join(repo, ...Array.from({ length: 12 }, (_, i) => `nested-folder-${i}`), '.claude', 'agent-memory', 'security-reviewer', 'MEMORY.md');
    const deepMemory: Line[] = [call([use('w1', 'Write', { file_path: deep, content: 'x' })]), result('w1', 'ok')];
    assert.equal(stop(repo, session(delegated, { im1: deepMemory })).stdout, '', 'however long the path, its extension is read whole');

    // In the background: nothing to check while it runs; its edits count from its notification.
    const background: Line[] = [human(risky), call([use('a1', 'Agent', { subagent_type: 'implementer', prompt: 'Step 1', run_in_background: true })]), ran('a1', 'im2', true)];
    const notice: Line = { type: 'user', message: { role: 'user', content: '<task-notification>\n<task-id>im2</task-id>\n<status>completed</status>\n</task-notification>' } };
    assert.equal(stop(repo, session(background, { im2: built })).stdout, '', 'still running');
    assert.match(decision(stop(repo, session([...background, notice], { im2: built }))).reason!, /Code changed after the last check \(src\/reset\.mjs\)/);
    const facts = (lines: Line[]) => windowFacts(parseTranscript(jsonl(lines)), { root: repo, subagents: { im2: windowFacts(parseTranscript(jsonl(built)), { root: repo }) } });
    assert.equal(facts([...background, ...test('b2'), notice]).verification.after_last_edit, false, 'a check run while it was still building covers nothing');
    assert.equal(facts([...background, notice, ...test('b2')]).verification.after_last_edit, true);
    assert.deepEqual(facts([...background, notice]).files_changed, ['src/reset.mjs']);
  });
});

describe('context-budget', () => {
  let n = 0;
  const usageLine = (tokens: number): Line => call([{ type: 'text', text: 'working' }], { usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0 } });
  const prompt = (repo: string, transcript: string, session: string) => runHook('context-budget.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'next', session_id: session, transcript_path: transcript }, { cwd: repo });
  const note = (r: HookResult): string => r.json?.hookSpecificOutput?.additionalContext ?? '';

  test('notes the agent once per budget band, resets after a compaction, and can be turned off', () => {
    const repo = makeRepo();
    const file = join(tempDir('as-budget-'), 't.jsonl');
    const session = `budget-${process.pid}-${++n}`;
    writeFileSync(file, jsonl([human('go'), usageLine(100_000)]));
    assert.equal(prompt(repo, file, session).stdout, '', 'under the budget');
    writeFileSync(file, jsonl([human('go'), usageLine(160_000)]));
    assert.match(note(prompt(repo, file, session)), /CONTEXT BUDGET — this context window is at about 160k tokens/);
    assert.equal(prompt(repo, file, session).stdout, '', 'once per band');
    writeFileSync(file, jsonl([human('go'), usageLine(310_000)]));
    assert.match(note(prompt(repo, file, session)), /about 310k tokens/);
    writeFileSync(file, jsonl([human('go'), usageLine(310_000), BOUNDARY, SUMMARY]));
    assert.equal(prompt(repo, file, session).stdout, '', 'a compaction resets the window');
    writeFileSync(file, jsonl([human('go'), usageLine(170_000)]));
    assert.match(note(prompt(repo, file, session)), /about 170k tokens/, 'the bands start again after a reset');
    writeConfig(repo, { workflow: { contextWarnTokens: 0 } });
    writeFileSync(file, jsonl([human('go'), usageLine(900_000)]));
    assert.equal(prompt(repo, file, `${session}-off`).stdout, '');
  });

  test('the agent\'s note asks for a handoff when work will remain', () => {
    const repo = makeRepo();
    const file = join(tempDir('as-budget-'), 't.jsonl');
    writeFileSync(file, jsonl([human('go'), usageLine(200_000)]));
    const text = note(prompt(repo, file, `budget-${process.pid}-${++n}`));
    assert.match(text, /If work will remain\s+when this task ends, make the handoff \(handoff skill\) its last step/);
    assert.match(text, /No need to comment on this note\.$/);
  });

  const stop = (repo: string, transcript: string, session: string, last = 'Done: the tests pass.') =>
    runHook('context-budget.mjs', { hook_event_name: 'Stop', session_id: session, transcript_path: transcript, stop_hook_active: false, last_assistant_message: last }, { cwd: repo });

  test('at the end of a turn past the budget, tells the person — never the agent — to /clear, once per band', () => {
    const repo = makeRepo();
    const file = join(tempDir('as-budget-'), 't.jsonl');
    const session = `budget-${process.pid}-${++n}`;
    writeFileSync(file, jsonl([human('go'), usageLine(100_000)]));
    assert.equal(stop(repo, file, session).stdout, '', 'under the budget');
    writeFileSync(file, jsonl([human('go'), usageLine(180_000)]));
    const r = stop(repo, file, session);
    assert.match(String(r.json?.systemMessage ?? ''), /^Context: this window is at about 180k tokens/);
    assert.match(String(r.json?.systemMessage ?? ''), /When this task is done,\s+\/clear before the next one/);
    assert.match(String(r.json?.systemMessage ?? ''), /Work that continues: \/handoff first/);
    assert.equal(r.json?.hookSpecificOutput, undefined, 'nothing enters the model\'s context');
    assert.equal(r.json?.decision, undefined, 'never blocks the stop');
    assert.equal(stop(repo, file, session).stdout, '', 'once per band');
    assert.match(note(prompt(repo, file, session)), /CONTEXT BUDGET/, 'the agent\'s note keeps its own band');
    writeFileSync(file, jsonl([human('go'), usageLine(320_000)]));
    assert.match(String(stop(repo, file, session).json?.systemMessage ?? ''), /about 320k tokens/, 'again at the next band');
    writeFileSync(file, jsonl([human('go'), usageLine(320_000), BOUNDARY, SUMMARY]));
    assert.equal(stop(repo, file, session).stdout, '', 'a compaction resets the window');
    writeFileSync(file, jsonl([human('go'), usageLine(160_000)]));
    assert.match(String(stop(repo, file, session).json?.systemMessage ?? ''), /about 160k tokens/, 'the bands start again after a reset');
  });

  test('stays quiet when the agent already advised /clear, and when the budget is off', () => {
    const repo = makeRepo();
    const file = join(tempDir('as-budget-'), 't.jsonl');
    writeFileSync(file, jsonl([human('go'), usageLine(200_000)]));
    assert.equal(stop(repo, file, `budget-${process.pid}-${++n}`, 'Done. This window is large: /clear before the next task.').stdout, '');
    writeConfig(repo, { workflow: { contextWarnTokens: 0 } });
    assert.equal(stop(repo, file, `budget-${process.pid}-${++n}`).stdout, '');
  });

  const start = (repo: string, source: string) => runHook('context-budget.mjs', { hook_event_name: 'SessionStart', source, session_id: `start-${process.pid}-${++n}` }, { cwd: repo });

  test('after /clear, points the agent to the handoff the window before it left', () => {
    const repo = makeRepo();
    assert.equal(start(repo, 'clear').stdout, '', 'no handoff: nothing to say');
    mkdirSync(join(repo, '.agents', 'handoffs'), { recursive: true });
    const old = join(repo, '.agents', 'handoffs', '2026-01-01-old.md');
    writeFileSync(old, '# Handoff — old\n');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(old, yesterday, yesterday);
    assert.equal(start(repo, 'clear').stdout, '', 'a handoff from earlier work is not this one');
    writeFileSync(join(repo, '.agents', 'handoffs', '2026-10-19-refunds.md'), '# Handoff — refunds\n');
    const r = start(repo, 'clear');
    assert.equal(r.json?.hookSpecificOutput?.hookEventName, 'SessionStart');
    assert.match(note(r), /^HANDOFF — the window before this \/clear left `\.agents\/handoffs\/2026-10-19-refunds\.md` \(written 1 min ago\)/);
    assert.match(note(r), /If the person\s+continues that work, read it first/);
    assert.equal(start(repo, 'startup').stdout, '', 'only after a /clear');
    assert.equal(start(repo, 'compact').stdout, '', 'a compaction keeps its own summary');
  });

  test('after /clear, a living plan document counts as the handoff', () => {
    const repo = makeRepo();
    writeConfig(repo, { docs: { plan: 'docs/PLAN.md' } });
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'PLAN.md'), '# Plan\n\n## Status\n');
    assert.match(note(start(repo, 'clear')), /left `docs\/PLAN\.md`/);
  });
});

// ---------------------------------------------------------------------------
// prompt-intake, and the prompt rubric it shares with the rows
// ---------------------------------------------------------------------------

describe('prompt rubric', () => {
  test('classifies what kind of message a prompt is', () => {
    const kind = (t: string): string => classifyPrompt(t).kind;
    assert.equal(kind(''), 'empty');
    assert.equal(kind('/gates --all'), 'command');
    assert.equal(kind('yes, go ahead'), 'reply');
    assert.equal(kind('option 2'), 'reply');
    assert.equal(kind('sim, pode avançar com isso'), 'reply');
    assert.equal(kind('How does the session refresh work in this app?'), 'question');
    assert.equal(kind('Is it safe to keep the refresh token in localStorage?'), 'question');
    assert.equal(kind('Can you add pagination to the users list in the admin page?'), 'task');
    assert.equal(kind('pode adicionar paginação à lista de utilizadores do admin'), 'task');
    assert.equal(kind('The checkout button does nothing on Safari since the last deploy'), 'task');
    assert.equal(kind('<ide_selection>how does this work?</ide_selection>\nAdd retries to the webhook sender in src/webhooks'), 'task');
  });

  test('intake speaks for large or risky tasks only', () => {
    assert.equal(intakeFor('What does the retry helper do?'), null, 'a question');
    assert.equal(intakeFor('fix the footer link'), null, 'a short task');
    assert.equal(
      intakeFor('Add pagination to `src/api/users.ts`, 50 per page. Only touch that file and its test. Done when `npm test` passes with a new test for page 2.'),
      null,
      'a task that says what done means, where, and what is out of scope',
    );
    assert.equal(intakeFor('make the dashboard load faster for our users, it feels slow lately'), null, 'vague, but small and harmless: a trigger, not a toll');
    const riskyVague = intakeFor('change how we store user passwords, the current way looks weak to me');
    assert.ok(riskyVague);
    assert.deepEqual(riskyVague.missing, ['acceptance', 'context', 'scope']);
    const risky = intakeFor('Add password reset by email to `src/auth/`. Done when the reset test passes. Only the auth module.');
    assert.ok(risky, 'well specified, but it touches auth');
    assert.deepEqual(risky.risks, ['auth']);
    const large = intakeFor('Build the new onboarding flow end to end: signup screen, email verification, profile setup. Tests must pass. Only the onboarding module.');
    assert.equal(large?.large, true);
  });

  test('prompt facts count task prompts, their score, and how many say how done is checked', () => {
    const f = promptFacts([{ text: 'yes' }, { text: 'Add a CSV export to `src/reports.ts`; done when `npm test` passes' }, { text: 'make it nicer somehow please, the page looks off' }]);
    assert.equal(f.tasks, 2);
    assert.equal(f.with_acceptance, 1);
    assert.ok(typeof f.mean_score === 'number' && f.mean_score > 0);
  });
});

describe('prompt-intake', () => {
  let n = 0;
  const ask = (repo: string, prompt: string, session = `intake-${process.pid}-${++n}`) =>
    runHook('prompt-intake.mjs', { hook_event_name: 'UserPromptSubmit', prompt, session_id: session }, { cwd: repo });
  const out = (r: HookResult): { note: string; tip: string } => ({
    note: r.json?.hookSpecificOutput?.additionalContext ?? '',
    tip: String((r.json as { systemMessage?: string } | null)?.systemMessage ?? ''),
  });

  test('asks for a brief on a risky task and names the gaps; never coaches the developer; silent on a vague small one', () => {
    const repo = makeRepo();
    const first = out(ask(repo, 'change how we store user passwords, the current way looks weak to me'));
    assert.match(first.note, /^INTAKE — It touches auth\. Before your first edit, write it back to the user as a brief/);
    assert.match(first.note, /does not say how "done" is checked, which files or area it is in, what is out of scope/);
    assert.equal(first.tip, '', 'no coaching');
    assert.equal(ask(repo, 'make the dashboard load faster for our users, it feels slow lately').stdout, '');
    assert.equal(ask(repo, 'now redo the settings page so it is consistent with the rest of the app and nicer').stdout, '');
  });

  test('silent on questions, replies, commands and specified tasks; a short follow-up refines the last brief', () => {
    const repo = makeRepo();
    for (const p of ['How does the cache invalidation work here?', 'yes', '/gates', 'Rename `getUser` to `fetchUser` in `src/api.ts` only; done when `npm test` passes.']) {
      assert.equal(ask(repo, p).stdout, '', p);
    }
    const session = `intake-follow-${process.pid}-${Date.now()}`;
    assert.match(out(ask(repo, 'Build the new onboarding flow end to end: welcome emails, profile setup and a progress bar', session)).note, /INTAKE — It is a large request/);
    assert.equal(ask(repo, 'and also make the subject lines shorter please', session).stdout, '', 'a short refinement');
  });

  test('a docs task and a plan to build are routed to the cheaper agent, when the project has it', () => {
    const repo = makeRepo();
    const docs = 'Write docs/api.md documenting every route in src/server.mjs, with an example request and response for each';
    const plan = 'The plan is agreed, build it: 1) add voidInvoice in src/billing.mjs 2) add the POST route in src/server.mjs 3) add the tests';
    assert.equal(ask(repo, docs).stdout, '', 'no doc-writer installed: nothing to route to');
    mkdirSync(join(repo, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'agents', 'doc-writer.md'), '---\nname: doc-writer\n---\n');
    mkdirSync(join(repo, '.codex', 'agents'), { recursive: true });
    writeFileSync(join(repo, '.codex', 'agents', 'implementer.toml'), 'name = "implementer"\n');
    assert.match(out(ask(repo, docs)).note, /^ROUTE — Do not write these docs yourself: delegate them now to the doc-writer agent, which runs on the low tier/);
    const built = out(ask(repo, plan)).note;
    assert.match(built, /^ROUTE — Do not type this plan out yourself: delegate the steps now to the implementer agent/, "Codex's agent folder counts, and the route comes first");
    for (const p of ['Fix the crash in src/report/export.mjs and update the README to match', 'Why is the README out of date with the CLI flags?', 'Add pagination to the invoices list endpoint, with tests for the edge cases']) {
      assert.doesNotMatch(ask(repo, p).stdout, /ROUTE/, p);
    }
  });

  test('risky work names the reviewer and the deliver skill when the project has them; it can be turned off', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'agents', 'security-reviewer.md'), '---\nname: security-reviewer\n---\n');
    mkdirSync(join(repo, '.agents', 'skills', 'deliver'), { recursive: true });
    writeFileSync(join(repo, '.agents', 'skills', 'deliver', 'SKILL.md'), '---\nname: deliver\n---\n');
    const note = out(ask(repo, 'Add Stripe subscriptions with a billing page and webhooks for renewals')).note;
    assert.match(note, /It touches payments/);
    assert.match(note, /have the security-reviewer agent check the change before you call it done — the deliver skill has the steps/);
    writeConfig(repo, { workflow: { promptIntake: false } });
    assert.equal(ask(repo, 'Add Stripe subscriptions with a billing page and webhooks for renewals').stdout, '');
  });

  test('a pull request per task: a task on the integration branch is told the cycle; a question, a feature branch or the default mode hear nothing', () => {
    const repo = makeRepo({ config: { ...TWO_TRUNK, workflow: { pullRequests: 'per-task' } } });
    const task = 'fix the footer link on the pricing page';
    const note = out(ask(repo, task)).note;
    assert.match(note, /^PR — This repository runs every change as its own pull request\. If this request changes files: before your first edit, cut feature\/<area>-<short-name> from 'develop', commit the brief and open a draft PR into 'develop'\./);
    assert.match(note, /mark it ready, merge it once its checks are green, and delete the branch — the ship-it skill, "A pull request per task", has the commands\. No need to mention this note\.$/);
    assert.equal(ask(repo, 'How does the footer get its links?').stdout, '', 'a question');
    const risky = out(ask(repo, 'Add Stripe subscriptions with a billing page and webhooks for renewals')).note;
    assert.match(risky, /^INTAKE — It touches payments[\s\S]*\nPR — [\s\S]*\nPlan before editing/, 'one note: the brief, then the cycle');
    writeConfig(repo, { ...TWO_TRUNK, workflow: { pullRequests: 'per-task', askMerge: true, promptIntake: false } });
    const asked = out(ask(repo, 'Add Stripe subscriptions with a billing page and webhooks for renewals')).note;
    assert.match(asked, /^PR — /, 'its own switch: said with promptIntake off');
    assert.doesNotMatch(asked, /INTAKE/);
    assert.match(asked, /mark it ready, ask the user to merge it, and delete the branch/);
    gitIn(repo, 'checkout', '-q', '-b', 'feature/footer');
    assert.equal(ask(repo, task).stdout, '', 'on a feature branch the cycle is under way');
    gitIn(repo, 'checkout', '-q', 'develop');
    writeConfig(repo, TWO_TRUNK);
    assert.equal(ask(repo, task).stdout, '', 'on-request, the default: nothing');
  });

  test('never holds an edit back', () => {
    const repo = makeRepo();
    const session = `gate-${process.pid}-${Date.now()}`;
    ask(repo, 'Add Stripe subscriptions with a billing page and webhooks for renewals', session);
    const edit = runHook('prompt-intake.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.mjs') }, session_id: session }, { cwd: repo });
    assert.equal(edit.code, 0);
    assert.equal(edit.stdout, '');
  });

  test('fails open on garbage', () => {
    const repo = makeRepo();
    for (const p of ['not json', { hook_event_name: 'UserPromptSubmit' }, { hook_event_name: 'Stop', prompt: 'make it faster somehow for everyone please' }]) {
      const r = runHook('prompt-intake.mjs', p, { cwd: repo });
      assert.equal(r.code, 0);
      assert.equal(r.stdout, '');
    }
  });
});

describe('window facts: prompts, briefs, subagents and setup', () => {
  test('rows record prompt quality, the briefs the agent wrote, and which subagents ran', () => {
    const f = windowFacts(
      parseTranscript(
        jsonl([
          human('make checkout faster, people complain it is slow'),
          reply('**Goal:** cut checkout time.\n**Scope:** the cart API only.\n**Acceptance:** p95 under 300 ms in the load test.'),
          call([use('a1', 'Agent', { subagent_type: 'agent-setup:scout', prompt: 'map checkout' })]),
          result('a1', 'map'),
          call([use('a2', 'Task', { subagent_type: 'security-reviewer', prompt: 'review' })]),
          result('a2', 'ok'),
          call([use('a3', 'Agent', { subagent_type: 'scout', prompt: 'again' })]),
          result('a3', 'ok'),
        ]),
      ),
    );
    assert.deepEqual(f.tools.agents, { scout: 2, 'security-reviewer': 1 });
    assert.equal(f.prompt_quality.tasks, 1);
    assert.equal(f.prompt_quality.with_acceptance, 0);
    assert.equal(f.prompt_quality.briefs, 1);
    const m = windowMetrics([{ session_id: 's', prompt_quality: { tasks: 4, with_acceptance: 1 } }, { session_id: 't', prompt_quality: { tasks: 0, with_acceptance: 0 } }]);
    assert.equal(m.acceptance, 0.25);
  });

  test('a check the permission system refused never ran: it is not a failed check', () => {
    const f = windowFacts(
      parseTranscript(
        jsonl([
          human('Fix the typo in src/a.mjs'),
          call([use('e1', 'Edit', { file_path: '/p/src/a.mjs' })]),
          result('e1', 'ok'),
          call([use('b1', 'PowerShell', { command: 'npm test' })]),
          result('b1', "Claude requested permissions to use PowerShell, but you haven't granted it yet.", true),
        ]),
      ),
      { root: '/p' },
    );
    assert.deepEqual([f.verification.after_last_edit, f.verification.passed], [false, null], 'unchecked, not failed');
  });

  test('session-eval tags each row with the setup, and a measure-only baseline shows the user nothing', () => {
    const repo = makeRepo({ learnings: true });
    writeFileSync(join(repo, '.agents', 'agent-setup.json'), JSON.stringify({ kit: { version: '9.9.9' }, selection: { mode: 'measure' } }));
    const transcript = join(tempDir('as-transcript-'), 'setup.jsonl');
    writeFileSync(transcript, jsonl([human('Add a health endpoint'), call([use('e1', 'Edit', { file_path: join(repo, 'a.mjs') })]), result('e1', 'ok')]));
    runHook('session-eval.mjs', { hook_event_name: 'SessionEnd', session_id: 's-setup', transcript_path: transcript }, { cwd: repo });
    const row = JSON.parse(readFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), 'utf8').trim()) as { setup: unknown };
    assert.deepEqual(row.setup, { kit: '9.9.9', mode: 'measure' });
    assert.equal(runHook('session-eval.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo }).stdout, '');
  });
});

// ---------------------------------------------------------------------------
// Model tiers and the usage report (_usage.mjs), and what session-eval records for them
// ---------------------------------------------------------------------------

const MODELS: ModelTable = readModels(join(HOOKS, '..', 'models.json')) as ModelTable;
const near = (a: number | null | undefined, b: number): boolean => typeof a === 'number' && Math.abs(a - b) < 1e-9;
const out1 = (output: number): Record<string, number> => ({ input: 0, output, cache_read: 0, cache_create: 0, cache_create_1h: 0, calls: 1 });

describe('model tiers and the usage report', () => {
  test('prices every kind of token: input, output, cache reads, 5-minute and 1-hour cache writes, long prompts', () => {
    const opus = priceFor(MODELS, 'claude-opus-5-5');
    // 1M each of input ($4), output ($20) and cache reads ($0.20); 1M cache writes, 400k of them for an hour: 600k × $5 + 400k × $8.
    assert.ok(near(costOf(opus, { input: 1e6, output: 1e6, cache_read: 1e6, cache_create: 1e6, cache_create_1h: 4e5 }), 30.4));
    const haiku = priceFor(MODELS, 'claude-haiku-5-5');
    // 1M input, 400k of it in calls whose prompt passed 100k: 600k × $0.10 + 400k × $0.50.
    assert.ok(near(costOf(haiku, { input: 1e6, output: 0, cache_read: 0, cache_create: 0, long: { input: 4e5, output: 0, cache_read: 0, cache_create: 0 } }), 0.26));
    const luna = priceFor(MODELS, 'gpt-6-luna');
    assert.ok(near(costOf(luna, { input: 0, output: 0, cache_read: 0, cache_create: 1e6 }), 0.1), 'no cache-write price: billed as input');
    assert.equal(costOf(null, { input: 1, output: 1, cache_read: 0, cache_create: 0 }), null);
  });

  test('finds a price and a tier by the bare model id, and an unlisted model by its family', () => {
    assert.equal(normalizeModel('us.anthropic.claude-haiku-4-5-20251001-v1:0'), 'claude-haiku-4-5');
    assert.equal(normalizeModel('claude-opus-4-5@20251101'), 'claude-opus-4-5');
    assert.equal(normalizeModel('claude-sonnet-5-5[1m]'), 'claude-sonnet-5-5');
    assert.ok(priceFor(MODELS, 'anthropic.claude-opus-5-5'));
    assert.deepEqual(tiersOf(MODELS, 'claude-sonnet-5-5'), ['medium']);
    assert.deepEqual(tiersOf(MODELS, 'gpt-6.1-sol'), ['high', 'medium'], 'one model can serve two tiers at two efforts');
    assert.deepEqual(tiersOf(MODELS, 'claude-opus-4-1'), ['high'], 'an older Opus is still the high tier');
    assert.deepEqual(tiersOf(MODELS, 'gemini-2.5-flash-lite'), ['low'], 'flash-lite, not flash');
    assert.deepEqual(tiersOf(MODELS, 'mystery-9'), []);
  });

  test("a project's overrides: its own prices, another model for a tier, the reference", () => {
    const t = mergeModels(MODELS, { prices: { 'claude-opus-5-5': { input: 3 } }, tiers: { openai: { low: 'gpt-6-sol' } }, reference: 'high' });
    assert.equal(priceFor(t, 'claude-opus-5-5')?.input, 3);
    assert.equal(priceFor(t, 'claude-opus-5-5')?.output, 20, "the fields merge over the kit's card");
    assert.equal(t.providers.openai.tiers.low?.model, 'gpt-6-sol');
    assert.equal(t.providers.openai.tiers.low?.effort, 'high', 'a model named alone keeps the tier effort');
    assert.equal(t.reference, 'high');
    assert.equal(priceFor(MODELS, 'claude-opus-5-5')?.input, 4, "the kit's table is left as it was");
  });

  test('the routing math: a run on a lower tier saves the difference, a run on a higher tier costs it', () => {
    const row = {
      session_id: 's',
      window: 0,
      recorded_at: '2026-10-01T10:00:00Z',
      models: { 'claude-sonnet-5-5': out1(1e6) },
      agents_usage: {
        scout: { runs: 2, models: { 'claude-haiku-5-5': out1(1e6) } },
        planner: { runs: 1, models: { 'claude-opus-5-5': out1(1e6) } },
      },
      verification: { edited: true, after_last_edit: true, passed: true },
    };
    const rep = usageReport([row], MODELS);
    assert.ok(near(rep.total, 30.5), 'main $10 + scout $0.50 + planner $20');
    assert.deepEqual(rep.routing.down.runs, { scout: 2 });
    assert.ok(near(rep.routing.down.atMain - rep.routing.down.cost, 9.5), 'the scout on the main model would have cost $10');
    assert.ok(near(rep.routing.up.cost - rep.routing.up.atMain, 10), 'the planner cost $10 more than the main model');
    assert.ok(near(rep.reference.cost, 30), 'every step on the main model');
    assert.equal(rep.quality.routed.windows, 1);
    assert.equal(rep.quality.routed.checked, 1);
    const text = usageText(rep);
    assert.match(text, /delegated down\s+scout 2: \$0\.500, on the main model \$10\.00 — up to \$9\.50 saved/);
    assert.match(text, /escalated up\s+planner 1: \$20\.00, on the main model \$10\.00 — \$10\.00 more/);
    assert.match(text, /every step on the main model: \$30\.00, actual \$30\.50 — 2% more/);
    assert.match(text, /a saving against the main model is a ceiling/, "a subagent's cold start is priced as if the main thread had spent it");
    // main $10 + scout $0.50, against $10 + the scout's tokens on the main model ($10): 9.5 / 20.
    assert.match(usageLine(usageReport([{ ...row, agents_usage: { scout: row.agents_usage.scout } }], MODELS)), /· up to 48% below every step on the main model$/);
    const vsHigh = usageReport([row], MODELS, { reference: 'high' });
    assert.ok(near(vsHigh.reference.cost, 60), 'every step on the high tier: 3M output at $20');
    assert.ok(near(vsHigh.reference.share, (60 - 30.5) / 60));
    assert.match(usageLine(vsHigh), /^\$30\.50 over 1 window \(\$30\.50 each\) · 49% below every step on the high tier$/);
  });

  test('a model without a price is costed at $0 and named, never guessed', () => {
    const rep = usageReport([{ session_id: 's', window: 0, models: { 'mystery-9': out1(10) } }], MODELS);
    assert.deepEqual(rep.unpriced, ['mystery-9']);
    assert.match(usageText(rep), /no price for mystery-9/);
    assert.match(usageText(usageReport([], MODELS)), /No usage recorded yet/);
  });

  test('the parser keeps the 1-hour cache writes, the calls with long prompts, and each subagent run', () => {
    const big = { input_tokens: 5, output_tokens: 10, cache_read_input_tokens: 150000, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } };
    const s = parseTranscript(
      jsonl([
        human('Review it'),
        { type: 'assistant', message: { id: 'b1', model: 'claude-sonnet-5', usage: big, content: [use('a1', 'Agent', { subagent_type: 'code-reviewer', prompt: 'review' })] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'READY' }] }, toolUseResult: { status: 'completed', agentId: 'cr1', agentType: 'code-reviewer', resolvedModel: 'claude-opus-5-5' } },
        reply('Reviewed.'),
      ]),
    );
    const m = s.models['claude-sonnet-5'];
    assert.equal(m.cacheCreate1h, 200);
    assert.equal(m.long?.cacheRead, 150000, 'the first call read a 150k prompt');
    assert.equal(m.long?.output, 10, 'the short reply is not in the long bucket');
    assert.deepEqual(s.subagentRuns, [{ id: 'cr1', type: 'code-reviewer', model: 'claude-opus-5-5' }]);
  });
});

describe('session-eval: what subagents used', () => {
  test("records each run's tokens from its own transcript, and --usage prices main thread and subagents", () => {
    const repo = makeRepo({ learnings: true });
    const dir = tempDir('as-transcript-');
    const transcript = join(dir, 's-sub.jsonl');
    writeFileSync(
      transcript,
      jsonl([
        human('Find where invoices are listed'),
        call([use('a1', 'Agent', { subagent_type: 'scout', prompt: 'map the invoice list' })]),
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'src/billing/invoices.mjs:12' }] }, toolUseResult: { status: 'completed', agentId: 'sc1', agentType: 'scout', resolvedModel: 'claude-haiku-5-5' } },
        reply('It is in src/billing/invoices.mjs.'),
      ]),
    );
    mkdirSync(join(dir, 's-sub', 'subagents'), { recursive: true });
    writeFileSync(
      join(dir, 's-sub', 'subagents', 'agent-sc1.jsonl'),
      jsonl([
        { type: 'user', isSidechain: true, message: { role: 'user', content: 'map the invoice list' } },
        { type: 'assistant', isSidechain: true, message: { id: 'sm1', model: 'claude-haiku-5-5', usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: 'map' }] } },
      ]),
    );
    const r = runHook('session-eval.mjs', { hook_event_name: 'SessionEnd', session_id: 's-sub', transcript_path: transcript }, { cwd: repo });
    assert.equal(r.stdout, '', 'a sensor adds nothing to the context');
    const row = JSON.parse(readFileSync(join(repo, '.agents', 'learnings', 'eval-windows.jsonl'), 'utf8').trim()) as Record<string, any>;
    assert.deepEqual(row.agents_usage, { scout: { runs: 1, models: { 'claude-haiku-5-5': { input: 2000, output: 500, cache_read: 0, cache_create: 0, cache_create_1h: 0, calls: 1 } } } });
    assert.ok(row.models['claude-sonnet-5'], 'the main thread stays under models');

    // --usage prices it with the project's copy of the table.
    writeFileSync(join(repo, '.agents', 'models.json'), readFileSync(join(HOOKS, '..', 'models.json'), 'utf8'));
    const usage = spawnSync(process.execPath, [join(HOOKS, 'session-eval.mjs'), '--usage'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
    assert.equal(usage.status, 0);
    assert.match(usage.stdout, /low\s+claude-haiku-5-5\s+1\s/);
    assert.match(usage.stdout, /medium\s+claude-sonnet-5\s/);
    assert.match(usage.stdout, /delegated down\s+scout 1: /);
  });

  test('the opt-in session-start line adds what the windows cost', () => {
    const repo = makeRepo({ learnings: true, config: { ...TWO_TRUNK, workflow: { sessionSummary: true } } });
    writeFileSync(join(repo, '.agents', 'models.json'), readFileSync(join(HOOKS, '..', 'models.json'), 'utf8'));
    const transcript = join(tempDir('as-transcript-'), 's-cost.jsonl');
    writeFileSync(transcript, jsonl([human('Rename the helper'), reply('Renamed.')]));
    runHook('session-eval.mjs', { hook_event_name: 'SessionEnd', session_id: 's-cost', transcript_path: transcript }, { cwd: repo });
    const start = runHook('session-eval.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    assert.match(String(start.json?.systemMessage ?? ''), /\n\$(<)?[\d.]+ over 1 window/);
    assert.match(String(start.json?.systemMessage ?? ''), /--summary, --usage/);
  });
});

// ---------------------------------------------------------------------------
// The prompt rubric and the transcript facts, as the hooks and the CLI read them
// ---------------------------------------------------------------------------

const STRONG: string = 'Add pagination to `lib/sync.mjs`. Only touch that file, never the tests. Verify with `npm test` and report green.';

describe('scorePrompt: rubric over the user prompt', () => {
  test('a concrete prompt scores high and names no gaps', () => {
    const r = scorePrompt(STRONG);
    assert.ok(r.score >= 85, JSON.stringify(r));
    assert.deepEqual(r.checks.filter((k) => !k.pass), []);
    assert.equal(r.suggestions.length, 0);
  });

  test('a vague prompt scores low and every gap gets advice', () => {
    const r = scorePrompt('make it better somehow');
    assert.ok(r.score < 30, JSON.stringify(r));
    assert.ok(r.suggestions.length >= 5, r.suggestions.join(' | '));
    assert.match(r.grade, /F/);
  });

  test('an empty prompt explains itself', () => {
    const r = scorePrompt('   ');
    assert.equal(r.score, 0);
    assert.match(r.suggestions[0], /empty/);
  });
});

// A short session: a prompt, a skill read and loaded, a failed edit, a report, and Claude Code's own cost line.
const SAMPLE_LINES = [
  { type: 'user', message: { role: 'user', content: 'Add pagination to lib/sync.mjs. Only touch that file. Verify with npm test.' }, timestamp: '2026-09-28T10:00:00.000Z', sessionId: 'sess-1', cwd: '/tmp/proj' },
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1000 },
      content: [
        { type: 'thinking', text: 'let me look' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '.agents/skills/backend/SKILL.md' } },
      ],
    },
    timestamp: '2026-09-28T10:00:05.000Z',
    sessionId: 'sess-1',
  },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, timestamp: '2026-09-28T10:00:06.000Z', sessionId: 'sess-1' },
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 100, output_tokens: 2000 },
      content: [
        { type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'agent-setup:backend' } },
        { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'lib/sync.mjs' } },
      ],
    },
    timestamp: '2026-09-28T10:01:00.000Z',
    sessionId: 'sess-1',
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'loaded' }, { type: 'tool_result', tool_use_id: 't3', content: 'no such file', is_error: true }] },
    timestamp: '2026-09-28T10:01:01.000Z',
    sessionId: 'sess-1',
  },
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 50, output_tokens: 400 },
      content: [{ type: 'text', text: '## Done\n- Added cursor pagination to lib/sync.mjs with tests\n- Ran npm test: green across the suite today' }],
    },
    timestamp: '2026-09-28T10:02:00.000Z',
    sessionId: 'sess-1',
  },
  {
    type: 'cost-state',
    sessionId: 'sess-1',
    totalCostUSD: 0.05,
    totalAPIDuration: 90000,
    totalToolDuration: 1200,
    totalDuration: 120000,
    modelUsage: { 'claude-sonnet-5': { inputTokens: 100, outputTokens: 2000, costUSD: 0.05 } },
  },
  { type: 'file-history-snapshot', message: {}, sessionId: 'sess-1' },
];
const SAMPLE_TEXT: string = SAMPLE_LINES.map((l) => JSON.stringify(l)).join('\n');

describe('parseTranscript: transcript fact', () => {
  test('counts one prompt, three tool calls, one failure, real tokens and real cost', () => {
    const s = parseTranscript(SAMPLE_TEXT, 'sess-1');
    assert.equal(s.sessionId, 'sess-1');
    assert.equal(s.prompts.length, 1, 'tool_result-only messages are not prompts');
    assert.deepEqual(s.tools.map((t) => t.name), ['Read', 'Skill', 'Edit']);
    assert.deepEqual(s.tools.map((t) => t.error), [false, false, true]);
    assert.equal(s.inputTokens, 1350);
    assert.equal(s.outputTokens, 2700);
    assert.equal(s.cacheRead, 5000);
    assert.equal(s.costUsd, 0.05, 'cost-state wins over estimates');
    assert.deepEqual(s.skillCalls, ['backend']);
    assert.deepEqual(s.skillDocReads, ['backend']);
    assert.deepEqual(s.filesChanged, [], 'the only edit failed, so no file changed');
    assert.match(s.lastAssistantText, /## Done/);
    assert.ok(!s.lastAssistantText.includes('let me look'), 'thinking blocks are not output');
    assert.equal(s.started, '2026-09-28T10:00:00.000Z');
  });

  test('unknown line types are ignored, empty input parses clean', () => {
    const s = parseTranscript('not json\n{"type":"weird","x":1}\n');
    assert.equal(s.prompts.length, 0);
    assert.equal(s.tools.length, 0);
    assert.equal(s.costUsd, null);
  });
});
