#!/usr/bin/env node
// PreToolUse hook for Bash AND PowerShell. Denies the git commands the branching
// contract exists to prevent, and names the correct alternative in every denial
// so the agent retries without needing the user.
//
// Why this exists when the git host protects branches too: server-side protection
// stops a push, not the local damage before it — discarding uncommitted work, a
// commit on production, a branch cut from it, a hook bypass — and many repositories
// (private ones on free plans, self-hosted remotes) have no server-side protection
// at all. The two together are the contract: this hook stops the agent early, with
// the alternative named; the host stops everyone at the door.
//
// The incident behind each rule is in docs/SDLC.md in the agent-setup repository.
// The short version:
//
//   · The upstream guard only inspected the `Bash` tool. On Windows, Claude Code
//     also has a `PowerShell` tool — every denial was one tool choice away from
//     not existing. Both are inspected now, and PowerShell here-strings are
//     stripped the way heredocs are.
//   · Matching was regex-over-the-whole-command. `git push origin feature/main-menu`
//     was denied (`\bmain\b` matches inside `main-menu`), while a bare `git push`
//     from `main`, `git checkout -b x` from `main`, and `git checkout -b x
//     origin/main` all passed. Commands are now split into invocations and
//     tokenised, refs are compared exactly, and the CURRENT branch is resolved
//     for commands that act on it implicitly.
//   · New, config-gated rules: commits and merges while standing on production,
//     force-pushes to the integration branch, deleting shared branches, and
//     commands that discard uncommitted work the agent did not write.
//
// Contract with the harness: exit 0 and print a permissionDecision of "deny"
// with a reason, or print nothing to allow. Never throw. Configured entirely by
// .agents/sdlc.config.json.

import { loadConfig, git, currentBranch, refMatches, logError } from './_config.mjs';

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

let payload = {};
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  payload = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '') || '{}');
} catch {
  process.exit(0); // Unparseable payload: allow. Failing closed here would wedge the session.
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
if (!payload || !SHELL_TOOLS.has(payload.tool_name)) process.exit(0);
const raw = String(payload.tool_input?.command ?? '');
if (!raw.trim()) process.exit(0);

// main() is invoked at the very bottom of this file, after every module-level
// constant it reads has been initialised. Calling it here would hit the TDZ, the
// catch below would swallow the ReferenceError, and the guard would silently
// allow everything — the exact "hook that looks like it works" failure.

// ---------------------------------------------------------------------------

function main() {
  const cfg = loadConfig();
  const b = cfg.branching;
  const g = cfg.guard;
  const PROD = b.production;
  const BASE = b.integration;
  const model = b.model;

  const productionWritesDenied = g.denyProductionWrites !== false && b.releaseOnRequestOnly !== false;
  const protectedPatterns = [PROD, ...b.protectedRefs].filter(Boolean);

  // Lazily-resolved repository facts. Each costs a git call, so only pay for the
  // ones a given command actually needs.
  let remoteList = null;
  const remotes = () =>
    (remoteList ??= [...new Set([...(git('remote') ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean), 'origin', 'upstream'])]);

  let branchKnown = false;
  let branchNow = null;
  const effective = () => {
    if (!branchKnown) {
      branchNow = currentBranch();
      branchKnown = true;
    }
    return branchNow;
  };
  const setEffective = (name) => {
    branchNow = name || null;
    branchKnown = true;
  };

  const trackedChanges = () =>
    (git('status', '--porcelain', '--untracked-files=no') ?? '').split(/\r?\n/).filter(Boolean).length;
  const untrackedFiles = () =>
    (git('status', '--porcelain', '--untracked-files=normal') ?? '').split(/\r?\n/).filter((l) => l.startsWith('??'))
      .length;
  const isLocalBranch = (name) => git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`) !== null;

  /** 'refs/heads/main', '+main', 'origin/main' → 'main'. 'release/1.0' stays. */
  const normalizeRef = (ref) => {
    if (!ref) return ref;
    let r = String(ref).replace(/^\+/, '').replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
    const slash = r.indexOf('/');
    if (slash > 0 && remotes().includes(r.slice(0, slash))) r = r.slice(slash + 1);
    return r;
  };
  const isProtected = (ref) => refMatches(protectedPatterns, normalizeRef(ref));
  const isIntegration = (ref) => BASE && BASE !== PROD && normalizeRef(ref) === BASE;

  const deny = (reason, instead) => {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: instead ? `${reason}\n\nInstead: ${instead}` : reason,
        },
      }),
    );
    process.exit(0);
  };

  const releaseInstead =
    `land the work on '${BASE}' instead. If the user explicitly asked for a release in this session, ` +
    'say so and ask them to run the release commands themselves, or to confirm in this turn.';

  // -------------------------------------------------------------------------
  // Rules, evaluated per invocation in command order.
  // -------------------------------------------------------------------------

  const checkBranchFrom = (newName, startPoint, implicit) => {
    if (g.denyBranchFromProduction === false || !BASE || BASE === PROD) return;
    if (model === 'gitflow' && newName && newName.startsWith(b.hotfixPrefix || 'hotfix/')) return;
    const from = implicit ? effective() : startPoint;
    if (!from || !isProtected(from)) return;
    deny(
      implicit
        ? `You are standing on '${from}', so this would cut '${newName ?? 'a branch'}' from production. ` +
            `A branch based on production misses whatever has already been integrated, and silently reverts it on merge.`
        : `Every branch is cut from '${BASE}', never from '${normalizeRef(from)}'. A branch based on production ` +
            'misses whatever has already been integrated, and silently reverts it on merge.',
      `git switch ${BASE} && git pull && git switch -c ${newName ?? '<name>'}`,
    );
  };

  const checkDiscard = (what) => {
    if (g.denyDiscardUncommitted === false) return;
    const n = trackedChanges();
    if (n === 0) return;
    deny(
      `${what} would discard ${n} uncommitted change(s) — possibly the user's work in progress, ` +
        'which no command can bring back.',
      'commit or stash the changes first, or ask the user. To drop only changes YOU made, restore those files by explicit path: `git restore <path>`.',
    );
  };

  const denyHookBypass = (what) =>
    deny(
      `${what} skips the repository's git hooks. They exist to catch exactly the problem you are about to ship; ` +
        'bypassing them is not a fix.',
      'run the hook, read what it reports, and fix the cause. If the user explicitly asked to skip hooks, ask them to run the command themselves.',
    );

  const onGit = (sub, args, hasDashC, configOverrides = []) => {
    const positional = positionalsOf(args);
    const here = hasDashC ? null : effective();

    if (g.denyNoVerify !== false) {
      if (configOverrides.some((kv) => /^core\.hookspath=/i.test(kv))) denyHookBypass('`git -c core.hooksPath=…`');
      const noVerify =
        args.includes('--no-verify') || (sub === 'commit' && args.some((t) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(t) && !t.startsWith('--')));
      if (noVerify && ['commit', 'push', 'merge', 'rebase', 'am', 'cherry-pick', 'revert'].includes(sub)) denyHookBypass(`\`git ${sub} --no-verify\``);
      if (sub === 'config' && changesHooksPath(args)) denyHookBypass('Changing core.hooksPath');
    }

    switch (sub) {
      case 'checkout':
      case 'switch': {
        const createFlag = sub === 'checkout' ? /^-[bB]$/ : /^(-c|-C|--create|--force-create)$/;
        const ci = args.findIndex((t) => createFlag.test(t));
        if (ci >= 0) {
          const newName = args[ci + 1];
          const after = positionalsOf(args.slice(ci + 2));
          checkBranchFrom(newName, after[0], after[0] === undefined);
          setEffective(newName);
          return;
        }
        const dd = args.indexOf('--');
        if (dd >= 0 || (sub === 'checkout' && positional.some((p) => BROAD_PATHS.has(p)))) {
          const paths = dd >= 0 ? args.slice(dd + 1) : positional;
          if (paths.some((p) => BROAD_PATHS.has(p))) checkDiscard(`\`git ${sub} ${args.join(' ')}\``);
          return; // restoring files, not switching branches
        }
        if (args.some((t) => t === '-f' || t === '--force' || t === '--discard-changes')) {
          checkDiscard(`\`git ${sub}\` with --force/--discard-changes`);
        }
        if (args.includes('--detach') || positional[0] === '-') {
          setEffective(null);
          return;
        }
        if (positional[0] && (sub === 'switch' || isLocalBranch(normalizeRef(positional[0])) || isProtected(positional[0]))) {
          setEffective(normalizeRef(positional[0]));
        }
        return;
      }

      case 'branch': {
        const flags = args.filter((t) => t.startsWith('-'));
        const isDelete = flags.some((f) => /^(--delete|-[a-zA-Z]*[dD][a-zA-Z]*)$/.test(f));
        if (isDelete) {
          for (const p of positional) {
            if (isProtected(p) || isIntegration(p)) {
              deny(`'${p}' is a shared long-lived branch. Deleting it is not an agent's call.`, 'leave it. If the user asked for this, ask them to run it themselves.');
            }
          }
          return;
        }
        const nonCreating = flags.some((f) =>
          /^(-l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--contains|--no-contains|--merged|--no-merged|-m|-M|--move|-c|-C|--copy|--edit-description|--set-upstream-to|-u|--unset-upstream|--sort|--format|--points-at|--column|--no-column|-q|--quiet)/.test(f),
        );
        if (!nonCreating && positional.length >= 1) checkBranchFrom(positional[0], positional[1], positional[1] === undefined);
        return;
      }

      case 'worktree': {
        if (args[0] !== 'add') return;
        const rest = args.slice(1);
        const bi = rest.findIndex((t) => t === '-b' || t === '-B');
        const newName = bi >= 0 ? rest[bi + 1] : null;
        const pos = positionalsOf(rest.filter((_, i) => bi < 0 || (i !== bi && i !== bi + 1)));
        if (newName) checkBranchFrom(newName, pos[1], pos[1] === undefined);
        return;
      }

      case 'add':
      case 'stage': {
        if (!g.denyBroadStaging) return;
        const broadFlag = args.some((t) => /^(--all|--update|--no-ignore-removal)$/.test(t) || /^-[a-zA-Z]*[Au][a-zA-Z]*$/.test(t));
        const narrowPaths = positional.filter((p) => !BROAD_PATHS.has(p));
        const broadPath = positional.some((p) => BROAD_PATHS.has(p));
        if (broadPath || (broadFlag && narrowPaths.length === 0)) {
          deny(
            'This working tree is shared with other agent sessions. `git add -A` / `git add .` / `git add -u` ' +
              'stages files another session is still working on, and commits them under your message.',
            'stage explicit paths: `git add path/one path/two`. Re-check `git status` first.',
          );
        }
        return;
      }

      case 'commit': {
        if (g.denyBroadStaging && args.some((t) => t === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(t))) {
          deny(
            'This working tree is shared with other agent sessions. `git commit -a` sweeps in ' +
              "every modified tracked file, including another session's.",
            'stage explicit paths with `git add`, then `git commit` without `-a`.',
          );
        }
        if (g.denyCommitOnProduction !== false && model !== 'trunk' && here && isProtected(here)) {
          deny(
            `You are on '${here}' — production. Commits land here only through a release the user asked for.`,
            `git switch ${BASE} (or cut a branch from it), then commit there.`,
          );
        }
        return;
      }

      case 'push': {
        const push = parsePush(args);
        if (push.all && productionWritesDenied) {
          deny('`git push --all` / `--mirror` pushes every local branch, production included.', 'push the one branch you mean: `git push origin <branch>`.');
        }
        const targets = push.targets.length ? push.targets : push.tagsOnly ? [] : [{ dst: here, implicit: true }];
        for (const t of targets) {
          if (!t.dst) continue;
          const dst = t.dst === 'HEAD' || t.dst === '@' ? here : t.dst;
          if (!dst) continue;
          if (productionWritesDenied && isProtected(dst)) {
            deny(
              `'${normalizeRef(dst)}' is production. It moves only when the user explicitly asks for a release, ` +
                'in this session, in words. "The work is finished" is not such a request.' +
                (t.implicit ? ` (A bare \`git push\` from '${here}' pushes '${here}'.)` : ''),
              releaseInstead,
            );
          }
          if (g.denyForcePushShared !== false && isIntegration(dst) && (push.force || t.force || t.delete)) {
            deny(
              `'${BASE}' is the shared integration branch. ${t.delete ? 'Deleting' : 'Force-pushing'} it rewrites ` +
                'history every other clone and session is built on.',
              'push a new commit instead (revert, or fix forward). If history really must change, ask the user to do it.',
            );
          }
        }
        return;
      }

      case 'merge':
      case 'rebase':
      case 'cherry-pick':
      case 'revert':
      case 'am': {
        if (!productionWritesDenied) return;
        if (sub === 'rebase' && positional[1] && isProtected(positional[1])) {
          deny(`\`git rebase ${positional[0]} ${positional[1]}\` checks out and rewrites '${positional[1]}' — production.`, releaseInstead);
        }
        if (args.some((t) => /^--(abort|quit|skip|continue|show-current-patch|edit-todo)$/.test(t))) return;
        if (!here || !isProtected(here)) return;
        const trunkAllowed = model === 'trunk' && (sub === 'cherry-pick' || sub === 'revert' || sub === 'am');
        if (trunkAllowed) return;
        deny(
          `You are on '${here}' — production. \`git ${sub}\` here writes to production, which moves only when ` +
            'the user explicitly asks for a release, in this session.',
          releaseInstead,
        );
        return;
      }

      case 'pull': {
        if (!productionWritesDenied || !here || !isProtected(here)) return;
        const pos = positional;
        // `git pull` / `git pull origin main` on main is a fast-forward from its own remote: allowed.
        // `git pull origin develop` on main merges another branch into production: not allowed.
        if (pos.length >= 2 && pos.slice(1).some((r) => normalizeRef(r.split(':')[0]) !== here)) {
          deny(`\`git pull ${pos.join(' ')}\` on '${here}' merges another branch into production.`, releaseInstead);
        }
        return;
      }

      case 'reset': {
        if (args.includes('--hard') || args.includes('--merge') || args.includes('--keep')) {
          if (args.includes('--hard')) checkDiscard('`git reset --hard`');
        }
        return;
      }

      case 'restore': {
        const staged = args.some((t) => t === '--staged' || t === '-S');
        const worktree = args.some((t) => t === '--worktree' || t === '-W');
        if (staged && !worktree) return; // only unstages
        const dd = args.indexOf('--');
        const paths = dd >= 0 ? args.slice(dd + 1) : positional;
        if (paths.some((p) => BROAD_PATHS.has(p))) checkDiscard(`\`git restore ${args.join(' ')}\``);
        return;
      }

      case 'clean': {
        if (g.denyDiscardUncommitted === false) return;
        const dry = args.some((t) => t === '-n' || t === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(t));
        const force = args.some((t) => t === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t));
        if (!force || dry) return;
        const ignoredToo = args.some((t) => /^-[a-zA-Z]*[xX][a-zA-Z]*$/.test(t));
        if (ignoredToo || untrackedFiles() > 0) {
          deny(
            '`git clean -f` permanently deletes untracked files' +
              (ignoredToo ? ' — with -x/-X that includes ignored files such as .env and local config' : '') +
              '. They may be the user’s new work; git cannot recover them.',
            'run `git clean -n` to list them, then delete specific paths you created. Ask the user about anything else.',
          );
        }
        return;
      }

      case 'stash': {
        if (!g.denyBroadStaging) return;
        const subc = args[0] && !args[0].startsWith('-') ? args[0] : 'push';
        if (!['push', 'save'].includes(subc)) return;
        const dd = args.indexOf('--');
        const hasPaths = dd >= 0 && args.length > dd + 1;
        if (!hasPaths) {
          deny(
            'This working tree is shared with other agent sessions. `git stash` without paths stashes ' +
              "another session's uncommitted work too — it disappears from under them.",
            'stash only your files: `git stash push -- path/one path/two`.',
          );
        }
        return;
      }

      default:
        return;
    }
  };

  const onGh = (args) => {
    // gh pr create --base <protected>. On a trunk, a pull request into it is the normal path
    // (the host's required checks and reviews gate the merge): only a separate production
    // branch is a release.
    if (args[0] !== 'pr' || args[1] !== 'create' || !productionWritesDenied || BASE === PROD) return;
    for (let i = 2; i < args.length; i++) {
      const t = args[i];
      let base = null;
      if (t === '--base' || t === '-B') base = args[i + 1];
      else if (t.startsWith('--base=')) base = t.slice(7);
      if (base && isProtected(base)) {
        deny(
          `A PR into '${normalizeRef(base)}' is a release. Production moves only when the user explicitly asks for one in this session.`,
          `open the PR into '${BASE}': \`gh pr create --base ${BASE}\`.`,
        );
      }
    }
  };

  // -------------------------------------------------------------------------
  // Walk every invocation in the command.
  // -------------------------------------------------------------------------

  const cleaned = stripHereStrings(stripHeredocs(raw));

  // The usual hook-skipping environment variables are not for agents.
  if (g.denyNoVerify !== false) {
    if (/(^|[\s;&|(])(HUSKY=0|HUSKY_SKIP_HOOKS=1|LEFTHOOK=0|SKIP=\S+|SKIP_HOOKS=1)\b/.test(cleaned) || /\$env:(HUSKY|LEFTHOOK|SKIP)\s*=/i.test(cleaned)) {
      denyHookBypass('Setting a hook-skipping environment variable (HUSKY=0, LEFTHOOK=0, SKIP=…)');
    }
  }

  for (const inv of invocations(cleaned, 0)) {
    if (inv.kind === 'git') onGit(inv.sub, inv.args, inv.hasDashC, inv.configOverrides);
    else if (inv.kind === 'gh') onGh(inv.args);
  }

  // Repo-specific denials from the config, matched against the whole command
  // with heredoc and here-string bodies stripped (upstream semantics).
  for (const rule of g.extraDeny) {
    try {
      if (rule && rule.pattern && new RegExp(rule.pattern).test(cleaned)) deny(rule.reason ?? 'Denied by guard.extraDeny.', rule.instead);
    } catch {
      // A malformed pattern in the config must not break the guard for everything else.
    }
  }

  // ---- helpers bound to this run ---------------------------------------

  function* invocations(cmd, depth) {
    if (depth > 3) return;
    for (const seg of splitSegments(cmd)) {
      const tokens = tokenize(seg);
      const i = locateCommand(tokens);
      if (i >= tokens.length) continue;
      const exe = basename(tokens[i]);

      if (exe === 'git') {
        const parsed = parseGit(tokens.slice(i + 1));
        if (!parsed) continue;
        let { sub, args } = parsed;
        if (!KNOWN_GIT.has(sub)) {
          // Resolve aliases: `git co -b x main` is `git checkout -b x main`.
          const alias = git('config', '--get', `alias.${sub}`);
          if (alias && alias.startsWith('!')) {
            yield* invocations(alias.slice(1) + ' ' + args.join(' '), depth + 1);
            continue;
          }
          if (alias) {
            const at = tokenize(alias);
            sub = at[0];
            args = [...at.slice(1), ...args];
          }
        }
        yield { kind: 'git', sub, args, hasDashC: parsed.dashC, configOverrides: parsed.configOverrides };
      } else if (exe === 'gh') {
        yield { kind: 'gh', args: tokens.slice(i + 1) };
      } else if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(exe)) {
        const ci = tokens.indexOf('-c', i + 1);
        if (ci >= 0 && tokens[ci + 1]) yield* invocations(tokens[ci + 1], depth + 1);
      } else if (exe === 'pwsh' || exe === 'powershell') {
        const ci = tokens.findIndex((t, k) => k > i && /^-(c|command)$/i.test(t));
        if (ci >= 0 && tokens[ci + 1]) yield* invocations(tokens.slice(ci + 1).join(' '), depth + 1);
      } else if (exe === 'cmd') {
        const ci = tokens.findIndex((t, k) => k > i && /^\/[ck]$/i.test(t));
        if (ci >= 0) yield* invocations(tokens.slice(ci + 1).join(' '), depth + 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Pathspecs that mean "everything".
const BROAD_PATHS = new Set(['.', './', ':/', ':(top)', '*', ':/*']);

const KNOWN_GIT = new Set([
  'add', 'am', 'apply', 'bisect', 'blame', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit',
  'config', 'describe', 'diff', 'fetch', 'grep', 'init', 'log', 'merge', 'merge-base', 'mv', 'pull', 'push',
  'rebase', 'reflog', 'remote', 'reset', 'restore', 'rev-list', 'rev-parse', 'revert', 'rm', 'show', 'stage',
  'stash', 'status', 'switch', 'symbolic-ref', 'tag', 'worktree', 'ls-files', 'ls-remote', 'shortlog', 'notes',
  'submodule', 'gc', 'format-patch', 'range-diff', 'cherry', 'whatchanged', 'help', 'version', 'var',
]);

/**
 * Strip heredoc bodies before matching.
 *
 * Learned the hard way upstream: the first version of this hook blocked its own
 * documentation, because a file being written with `cat > f <<'EOF'` contained
 * the words `git push origin main` inside the heredoc. Anything a heredoc
 * carries is data this shell never executes, so scanning it produces only false
 * positives — and a guard that fires on documentation gets disabled within a day.
 */
function stripHeredocs(cmd) {
  const lines = cmd.split(/\r?\n/);
  const out = [];
  let terminator = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue; // body -- never executed, never scanned
    }
    // <<EOF, <<-EOF, <<'EOF', <<"EOF"
    const m = line.match(/<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) terminator = m[2];
    out.push(line);
  }
  return out.join('\n');
}

/**
 * The PowerShell equivalent of a heredoc: @' ... '@ and @" ... "@. The opener
 * ends its line; the closer starts one. Everything between is data.
 */
function stripHereStrings(cmd) {
  const lines = cmd.split(/\r?\n/);
  const out = [];
  let close = null;
  for (const line of lines) {
    if (close !== null) {
      const t = line.trimStart();
      if (t.startsWith(close)) {
        close = null;
        out.push(t.slice(2));
      }
      continue;
    }
    const m = line.match(/@(['"])\s*$/);
    if (m) {
      close = `${m[1]}@`;
      out.push(`${line.slice(0, m.index)}''`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Split a command line into simple commands: on ; && || | & and newlines, and
 * on subshell / substitution / script-block boundaries, honouring quotes. A `$(`
 * or backtick opens a substitution even inside double quotes, because the shell
 * executes it there too.
 */
function splitSegments(cmd) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const n = cmd[i + 1];
    if (q === "'") {
      cur += c;
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\' && n !== undefined) {
        cur += c + n;
        i++;
        continue;
      }
      if ((c === '$' && n === '(') || c === '`') {
        segs.push(cur);
        cur = '';
        q = null;
        if (c === '$') i++;
        continue;
      }
      cur += c;
      if (c === '"') q = null;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
      continue;
    }
    if (c === '$' && n === '(') {
      segs.push(cur);
      cur = '';
      i++;
      continue;
    }
    if ('\n\r;|&(){}`'.includes(c)) {
      segs.push(cur);
      cur = '';
      if ((c === '&' || c === '|') && n === c) i++;
      continue;
    }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

/** Shell-ish word splitting with single and double quotes. */
function tokenize(seg) {
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < seg.length && '"\\$`'.includes(seg[i + 1])) cur += seg[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has) {
        out.push(cur);
        cur = '';
        has = false;
      }
      continue;
    }
    cur += c;
    has = true;
  }
  if (has) out.push(cur);
  return out;
}

const PREFIXES = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'env', 'nice', 'builtin', 'then', 'do', 'else', '!', 'xargs', 'call']);

/** Index of the executable in a token list, skipping env assignments and wrappers. */
function locateCommand(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || PREFIXES.has(t)) {
      i++;
      continue;
    }
    if (t === 'timeout') {
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function basename(token) {
  return String(token).replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
}

/** Skip git's global options (`-C path`, `-c k=v`, `--no-pager`, …) and return the subcommand. */
function parseGit(rest) {
  let i = 0;
  let dashC = false;
  const configOverrides = [];
  while (i < rest.length && rest[i].startsWith('-')) {
    const t = rest[i];
    if (t === '-C') {
      dashC = rest[i + 1] !== '.';
      i += 2;
      continue;
    }
    if (t === '-c') {
      if (rest[i + 1]) configOverrides.push(rest[i + 1]);
      i += 2;
      continue;
    }
    if (t.startsWith('--config-env')) {
      i += t.includes('=') ? 1 : 2;
      continue;
    }
    if (t === '--git-dir' || t === '--work-tree' || t === '--namespace' || t === '--exec-path') {
      i += 2;
      continue;
    }
    i++;
  }
  const sub = rest[i];
  return sub ? { sub, args: rest.slice(i + 1), dashC, configOverrides } : null;
}

// Options that consume the following token, so it is not mistaken for a ref or path.
const VALUE_OPTS = new Set([
  '-m', '--message', '-F', '--file', '-C', '-c', '--author', '--date', '--template', '-t', '--track',
  '--repo', '-o', '--push-option', '--receive-pack', '--exec', '-s', '--strategy', '-X', '--strategy-option',
  '--onto', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--cleanup', '--source', '-S',
  '--gpg-sign', '--depth', '--shallow-since', '--upstream', '--set-upstream-to', '--format', '--sort',
]);

function positionalsOf(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (t.startsWith('-')) {
      if (VALUE_OPTS.has(t)) i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * Does this `git config` change core.hooksPath? Reading it is how an agent checks that the hooks
 * are on; only a change skips them: a value after the key, --unset, --replace-all or --add, or
 * the `set` and `unset` subcommands.
 */
function changesHooksPath(args) {
  const pos = positionalsOf(args);
  const at = pos.findIndex((t) => /^core\.hookspath$/i.test(t));
  if (at < 0) return false;
  if (['set', 'unset'].includes(pos[0]) || args.some((t) => /^--(unset|unset-all|replace-all|add)$/.test(t))) return true;
  if (['get', 'list'].includes(pos[0]) || args.some((t) => /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list)$/.test(t))) return false;
  return at < pos.length - 1;
}

/** Parse `git push` arguments into destination refs. */
function parsePush(args) {
  let force = false;
  let del = false;
  let all = false;
  let tagsOnly = false;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (/^--force(-with-lease|-if-includes)?(=.*)?$/.test(t) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t)) force = true;
    if (t === '--delete' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(t)) del = true;
    if (t === '--all' || t === '--mirror' || t === '--branches') all = true;
    if (t === '--tags') tagsOnly = true;
    if (t.startsWith('-')) {
      if (VALUE_OPTS.has(t)) i++;
      continue;
    }
    pos.push(t);
  }
  const refspecs = pos.slice(1); // pos[0] is the remote
  const targets = [];
  for (const rs of refspecs) {
    let spec = rs;
    let plus = false;
    if (spec.startsWith('+')) {
      plus = true;
      spec = spec.slice(1);
    }
    const colon = spec.indexOf(':');
    if (colon === 0) {
      targets.push({ dst: spec.slice(1), delete: true });
      continue;
    }
    const dst = colon > 0 ? spec.slice(colon + 1) : spec;
    targets.push({ dst, force: plus, delete: del });
  }
  return { targets, force, all, tagsOnly };
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  main();
} catch (err) {
  // A bug in the guard must never block legitimate work — but it must be visible.
  logError('guard-git', err);
}
process.exit(0);