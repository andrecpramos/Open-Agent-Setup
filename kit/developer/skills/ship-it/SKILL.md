---
name: ship-it
description: >
  Commit and open a pull request the way this repository expects — run the gates, stage only
  the intended files (explicit paths on a shared tree), write a Conventional Commit with an
  allowed scope and the required trailers from .agents/sdlc.config.json, push the feature
  branch, and open a PR into the integration branch with a description reviewers can act on —
  never into production unless the user asked for a release in this session. Use when the user
  says "commit", "ship it", "push this", "open a PR", "create a pull request" or "we're done,
  send it".
---

# Ship it

Committing is the moment unrelated files, secrets and half-verified work slip into history,
and pushing is the moment they reach everyone else. This procedure makes both deliberate.

## Before you start

- Read `.agents/overlays/ship-it.md` if it exists; it wins where it disagrees.
- Read `.agents/sdlc.config.json`: `branching` (production, integration, featurePrefix,
  releaseOnRequestOnly), `sharedTree`, `commits` (convention, scopes, trailers). If the repo has
  a PR template (`.github/pull_request_template.md` or similar), it replaces the one below.
- Commit, push and open PRs only when the user asked for that in this conversation. **"Ship
  it" asks for a commit or a PR — it is not a request to release to production.**

## Procedure

1. **Know where you are:** `git status`, `git branch --show-current`, and the diff against the
   integration branch. On production (two-trunk/gitflow)? Stop — move the work to a branch cut
   from integration. On integration with more than a trivial change? Propose
   `<featurePrefix><area>-<short-name>` and ask.
2. **Run the gates** (`gates` skill, or the `gate-runner` agent). Don't commit over a failing
   blocking gate unless the user explicitly says so — and then say it in the commit body and PR.
3. **Stage deliberately.** Read `git status` and `git diff`; stage the explicit paths you changed
   for this task. On a shared tree never `git add -A`, `.` or `-u`. Leave files you didn't touch.
   Never stage secrets, `.env*`, credentials, local config, large binaries or ignored generated
   output. Re-check `git status` immediately before committing.
4. **Write the message.** With `commits.convention: conventional`:
   `type(scope): summary` — type from feat, fix, perf, refactor, test, docs, build, ci, chore,
   revert; scope from `commits.scopes` when constrained; imperative mood, lowercase, ≤ 72
   characters. The body says *why*, for someone bisecting in six months. A breaking change gets
   `!` and a `BREAKING CHANGE:` footer. Append every `commits.trailers` line exactly. Pass a
   multi-line message through a heredoc, a here-string or `-F <file>`.
5. **Commit without `--no-verify`.** If a hook fails, fix the cause and commit again — a new
   commit, not an `--amend` (after a failed hook, amending rewrites the *previous* commit).
6. **Push the feature branch:** `git push -u origin HEAD`. Never force-push a shared branch;
   rewrite your own feature branch only when asked, with `--force-with-lease`.
7. **Open the PR into the integration branch** (`gh pr create --base <integration>`, or the
   platform's CLI). Never `--base <production>` unless the user asked for a release in this
   session — the guard denies it anyway.
8. **Report:** branch, commit hash and message, PR URL, gate results, and anything unverified.

## PR description

```markdown
## What
<the change, in terms a user or reviewer recognises>

## Why
<the problem or issue link>

## How
<the decisions a reviewer would ask about>

## Verification
<gates and results; manual checks; screenshots for UI changes>

## Risk and rollback
<what could break; how to roll back; migrations or flags involved>
```

## Releases

Only when the user explicitly asks for a release in this session: follow the release procedure
the repository documents (AGENTS.md, `.agents/docs/project.md` or its contributing guide —
typically a fast-forward merge of integration into production, a push and a tag). The guards deny these commands to agents by design — show the
exact commands and let the user run them, or have them confirm how they want to proceed. Never
merge a PR on your own initiative.

## The mistakes that matter

- Sweeping unrelated or another session's files into the commit.
- Treating "the work is finished" as permission to push or PR into production.
- `--no-verify`, or amending to hide a hook failure.
- Messages that say nothing: "fix", "update", "wip", "changes".
- Claiming CI will pass without having run the gates.
- Committing secrets, local config, or generated artefacts the repo ignores.

## Done means

The commits are on the right branch with conventional messages and trailers, the gates are
reported honestly, and — if asked — a PR into the integration branch exists with a complete
description, and its URL is in your answer.
