#!/usr/bin/env node
// SessionStart: says something about the branch only when it needs attention — standing on
// production, a detached HEAD, a feature branch that no longer contains the integration
// branch, or a config that names a branch this clone does not have — and then states the
// branching contract with the live git facts attached.
//
// Why silent otherwise: the agent already gets the current branch and status at session
// start, and guard-git denies the commands the contract exists to prevent, naming the
// alternative. Restating a healthy contract in every new context window cost tokens and
// taught agents to skim the channel the important messages arrive on.
//
// Why live state when it does speak: an agent told "you are on feature/x, 0 ahead and 2
// behind" asks a useful question. One told "consider branching" does not.
//
// Two team settings make it speak every time: `workflow.askBranch: true` (ask the user where
// to work before the first edit) and `sharedTree: true` (several sessions share this tree).
// A missing or provisional config is said to the person, once, at startup — a line the model
// never sees.
//
// Contract with the harness: print one JSON object, or nothing. NEVER exit non-zero and NEVER
// throw -- a failing SessionStart hook blocks the session. Configured entirely by
// .agents/sdlc.config.json. Why each rule is the way it is: docs/SDLC.md in the agent-setup
// repository.

import { loadConfig, git, insideWorkTree, readPayload, emitContext, logError } from './_config.mjs';

try {
  const cfg = loadConfig();
  const { production: PROD, integration: BASE, featurePrefix, model } = cfg.branching;

  const payload = await readPayload();
  // SessionStart sends .source (startup|resume|clear|compact|fork); PreCompact sends .trigger.
  const event = payload.hook_event_name ?? 'SessionStart';
  const reason = payload.source ?? payload.trigger ?? 'startup';

  // Outside a work tree there is no contract to state.
  if (!insideWorkTree()) process.exit(0);

  const rawBranch = git('rev-parse', '--abbrev-ref', 'HEAD') ?? 'unknown';
  const detached = rawBranch === 'HEAD';
  const branch = detached ? `(detached at ${git('rev-parse', '--short', 'HEAD') ?? '?'})` : rawBranch;
  // A fresh clone has only the branch it checked out; the others are origin/<name>. Compare
  // against that rather than calling the config wrong.
  const exists = (ref) => git('rev-parse', '--verify', '--quiet', ref) !== null;
  const baseRef = !BASE ? null : exists(BASE) ? BASE : exists(`origin/${BASE}`) ? `origin/${BASE}` : null;
  const hasBase = baseRef !== null;

  /** Commits on `a` not on `b`. */
  const countRange = (a, b) => {
    const out = git('rev-list', '--count', `${b}..${a}`);
    const n = Number.parseInt(out ?? '', 10);
    return Number.isFinite(n) ? n : null;
  };

  // What needs attention, if anything.
  let situation = '';
  if (detached) {
    situation =
      `HEAD is detached ${branch}. Commits made here belong to no branch and are easy to lose.\n` +
      `Before any edit, switch to '${BASE}' or cut a branch from it.`;
  } else if (rawBranch === PROD && model !== 'trunk') {
    situation =
      `You are on '${PROD}' — PRODUCTION. Do not commit here.\n` +
      `Before any edit, switch to '${BASE}' or cut a branch from it.`;
  } else if (rawBranch !== BASE && !hasBase) {
    situation =
      `You are on '${branch}'. Branch '${BASE}' exists neither locally nor as 'origin/${BASE}', so this\n` +
      `hook cannot compare against it. Fetch it, or correct 'branching.${model === 'trunk' ? 'production' : 'integration'}'\n` +
      `in .agents/sdlc.config.json — one of the two is wrong.`;
  } else if (rawBranch !== BASE) {
    const ahead = countRange(rawBranch, baseRef);
    const behind = countRange(baseRef, rawBranch);
    if (behind !== null && behind > 0) {
      situation =
        `You are on feature branch '${branch}' — ${ahead ?? '?'} ahead, ${behind} behind '${baseRef}'.\n` +
        `⚠ It does NOT contain the tip of '${baseRef}' and will carry stale work on merge.\n` +
        `   Rebase or merge '${baseRef}' in before going further.`;
    }
  }

  const askBranch = cfg.workflow?.askBranch === true;
  const shared = cfg.sharedTree === true;
  const userNote =
    event === 'SessionStart' && (reason === 'startup' || reason === 'clear') && (!cfg.found || cfg.provisional)
      ? `agent-setup: this repository's SDLC contract is ${cfg.found ? 'provisional, with no gates yet' : 'missing'} — run /sdlc-init once to verify the branches and add the checks CI runs.`
      : '';

  if (!situation && !askBranch && !shared) {
    // Nothing for the agent; at most the person's one line.
    emitContext(event, '', userNote);
  }

  const dirty = (git('status', '--porcelain') ?? '').split('\n').filter(Boolean).length;
  const contract = [
    cfg.branching.releaseOnRequestOnly
      ? `'${PROD}' is production: it moves only when the user explicitly asks for a release in this session.`
      : '',
    model === 'trunk'
      ? `'${PROD}' is the trunk; branches are short-lived and merge back into it.`
      : `Every branch is cut from '${BASE}' and merges back into '${BASE}', never into '${PROD}'.` +
        (model === 'gitflow' ? ` Exception: '${cfg.branching.hotfixPrefix}*' branches are cut from '${PROD}' and merge into both.` : ''),
  ].filter(Boolean);

  const askClause = askBranch
    ? `\nBefore you make any code change, ask the user whether to keep working on\n` +
      `'${branch}' or cut a new branch from '${BASE}', and wait for the answer. Propose a\n` +
      `concrete name (convention: ${featurePrefix}<area>-<short-name>). Skip the question for\n` +
      `read-only requests. Ask once per context window, not before every edit.\n`
    : '';
  const sharedClause = shared
    ? `\nThis tree is worked on by more than one session at a time. Stage explicit\n` +
      `paths; never 'git add -A' or 'git commit -a'. Re-check 'git status'\n` +
      `immediately before committing, and leave modified files you did not touch alone.\n`
    : '';
  // The agent needs to know the contract is unverified; running /sdlc-init is the person's
  // call, so that reminder goes to them instead of into the agent's replies.
  const configClause = !cfg.found
    ? `\nNOTE: no .agents/sdlc.config.json was found, so these are the kit's DEFAULTS\n` +
      `('${PROD}' / '${BASE}'), not this repo's verified contract.\n`
    : cfg.provisional
      ? `\nNOTE: .agents/sdlc.config.json is PROVISIONAL — written at install time from\n` +
        `what git showed, not verified, and it has no gates yet.\n`
      : '';

  emitContext(
    event,
    `BRANCH CHECK (${event}: ${reason}) — ${situation || `you are on '${branch}'.`}
Uncommitted changes: ${dirty} file(s).
Contract: ${contract.join(' ')}
${askClause}${sharedClause}${configClause}`,
    userNote,
  );
} catch (err) {
  // Fail open: a broken check must never block the session — but leave a trace.
  logError('branch-check', err);
  process.exit(0);
}
