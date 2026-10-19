# The SDLC layer — and why each rule is the way it is

The SDLC layer turns a repository's delivery contract into mechanics: `.agents/sdlc.config.json`
(branches, gates, guard settings, workflow switches), the hooks that read it, and the method
that writes it (`sdlc-init`) and audits it (`enforcement-audit`). For every agent and person,
the contract's last line is branch protection on the git host; the hooks stop Claude Code early.

Each rule below names the defect or the incident behind it — a rule without its incident tends
to get optimised away. Every behavioural rule is covered by `tests/hooks.test.mjs`.

## Where it lives

| Piece | In the kit |
|---|---|
| The contract | `sdlc.config.json` in each project; its schema and two worked examples in `kit/admin/skills/sdlc-init/assets/` |
| Runtime hooks | `kit/hooks/` — `_config` (the loader every hook uses); the developer role's `branch-check`, `guard-git`, `check-gates`, `stop-check`, `prompt-intake`, `context-budget`, `setup-clone`; the admin role's `learning-signals`, `session-eval`; `run-hook`, which runs them in every other agent; and the shared `_transcript` and `_prompt` modules |
| Wiring | `kit/settings.fragment.json` — merged into a project's settings by the installer, never copied |
| Install procedure | the `sdlc-init` skill |
| Workflow method | `kit/admin/skills/sdlc-init/references/workflow.md` |
| Enforcement method | the `enforcement-audit` skill and its reference |
| Knowledge-base templates | `kit/admin/skills/sdlc-init/assets/templates/` |
| Drift detection | the project manifest hashes every kit-owned file; `agent-setup status` reports drift in all of them |

## The command guard (`guard-git.mjs`)

**1 · Both shell tools are guarded.** A guard that inspected only the `Bash` tool, wired with
`matcher: "Bash"`, let `git push origin main` through Claude Code's `PowerShell` tool on Windows
unopposed. The matcher is `Bash|PowerShell`, both tool names are handled, and PowerShell
here-strings (`@' … '@`) are stripped the way heredocs are.

**2 · Commands are parsed, not pattern-matched.** A regex over the whole command both over- and
under-matched: `\bmain\b` matches inside `feature/main-menu`, so pushing that branch was denied,
while a bare `git push` standing on `main`, `git checkout -b x` on `main` and
`git checkout -b x origin/main` all passed. The guard splits the command into invocations
(respecting quotes, `&&`, `;`, pipes, subshells and `$(…)`), tokenises each, resolves the
**current branch** for commands that act on it implicitly, strips remote prefixes, and compares
refs exactly (globs for `protectedRefs`). Nested shells (`bash -c`, `pwsh -Command`, `cmd /c`),
wrappers (`timeout`, `env`, `VAR=…`) and git aliases are followed.

**3 · "Do not commit here" is enforced, not stated.** `guard.denyCommitOnProduction` (default
on, not in the trunk model) denies commits, merges, rebases, cherry-picks and `pull <other>`
while standing on production.

**4 · Gitflow's hotfixes are allowed.** Branching from production is denied in every model
except for `branching.hotfixPrefix` branches in gitflow, which the branching template itself
cuts from production.

**5 · `releaseOnRequestOnly: false` works.** Production-write denials require both it and
`guard.denyProductionWrites`, so the documented switch does what it says.

**6 · Config-gated protections**, each for a failure seen in agent sessions:

| Setting (default) | Denies | Because |
|---|---|---|
| `denyForcePushShared` (on) | force-pushing or deleting the integration branch | it rewrites history every clone is built on |
| `denyDiscardUncommitted` (on) | `reset --hard`, `checkout .`, `restore .` over uncommitted changes; `clean -f` over untracked files | an agent "cleaning up" destroys the user's work in progress, unrecoverably |
| `denyNoVerify` (on) | `--no-verify`, `-c core.hooksPath=…`, changing `core.hooksPath` (reading it is how an agent checks the hooks are on, and passes), `HUSKY=0`, `SKIP=…`, the git-hook escape variable; `gh pr merge --admin` | skipping a hook ships the problem it caught; `--admin` merges past the host's required checks and reviews, the hooks of the pull request |
| `sharedTree` (extended) | also `git add -u` and `git stash` without paths | both sweep in another session's work |

## All hooks

**7 · Fail open, but leave a trace.** A hook must never block a session on its own error, so
every exception is caught. Two hooks once shipped a temporal-dead-zone `ReferenceError`
(module-level constants read before initialisation under top-level `await`) and both *looked
like they worked*, because failing open is indistinguishable from "nothing to say". Hooks write
swallowed errors to stderr (Claude Code keeps them in its debug log for an exit-0 hook, at no
cost to the session), keep their entry point at the end of the file, and the test suite fails
on any stderr.

**8 · Exec-form wiring.** `node .agents/hooks/x.mjs` through a named shell breaks twice: a
relative path fails when the session starts in a subdirectory, and on Windows the `bash` on
PATH can be WSL's rather than Git Bash. The kit wires `"command": "node", "args":
["${CLAUDE_PROJECT_DIR}/…"]`, so no shell parses anything.

**9 · Nothing is injected at `PreCompact`.** `SessionStart` fires again with source `compact`
and re-states the contract in the fresh window; text added at `PreCompact` lands in the context
about to be summarised. `session-eval` uses `PreCompact` only to record facts.

**10 · `check-gates` covers every edit tool** (`Edit|Write|MultiEdit|NotebookEdit`), accepts
brace globs (`src/**/*.{ts,tsx}`) like Claude Code's own `paths:` syntax, and says when a check
timed out instead of reporting a generic failure.

**11 · `branch-check` speaks only when the branch needs attention** — production, a detached
HEAD, a branch whose remote branch is gone (its pull request merged or closed: new work there
starts from a finished branch; known after a fetch with `--prune`, since the hook never touches
the network), a feature branch behind the integration branch, a config naming a branch the clone does
not have, locally or as `origin/<branch>` (a fresh clone has only the branch it checked out, so
the others are compared through their remote-tracking ref) — and then states the situation precisely (the trunk model's wording, the gitflow
hotfix exception) with the contract in two lines. Restating a healthy contract at every new
context window cost tokens in every session, while the agent already gets the branch and status
at session start and `guard-git` denies what the contract forbids, naming the alternative. It
tells *no config* from a *provisional* one; running `/sdlc-init` is the person's call, so that
reminder goes to them, once at startup, as a message the model never sees: handed to the agent,
it ended up in the report of a one-line fix.

**12 · The agent decides where to work.** Telling the agent to ask which branch to use before
its first edit made a one-word fix cost a round trip, measured against the same agent without
the kit. Where to work is a cheap guess to correct — nothing is committed until the user asks,
and the guard still blocks production — so the agent decides (small changes on the integration
branch, larger ones on a new feature branch) and names the branch in its brief.
`workflow.askBranch: true` restores the question.

**12a · One set of hooks, every agent.** Up to 2.x the hooks ran in Claude Code only, and every
other agent got the rules as text. By 2026 Codex, Cursor, GitHub Copilot, Antigravity and
Windsurf all have hook systems, each with its own file, event names and payloads. Rewriting
each hook per agent would split every rule into five copies that drift; instead
`run-hook.mjs` translates the agent's payload into Claude Code's shape (which Codex already
speaks), runs the unchanged hook, and translates the answer back — a denial becomes Cursor's
`permission: deny`, Copilot's `permissionDecision`, Antigravity's `decision`, Windsurf's exit
code 2. An agent gets a hook only where it has an event that can do the job: the guard
everywhere; the post-edit check and the branch note where a hook can hand the agent a note;
the brief where a prompt hook can. stop-check, session-eval and context-budget stay Claude
Code's: they read its session transcript, and every agent writes its own differently.

## Settings

**13 · Protections are `Edit(…)` rules on the paths that exist.** `ask` rules for files under a
config root the kit no longer used protected nothing, and `Write(…)` rules are not matched at
all — an end-to-end run of Claude Code reported *"Write(path) is not matched by file permission
checks — only Edit(path) rules are"*. `Edit(…)` rules cover every file-editing tool. They guard
the contract, the ADRs and the rules, and also `.claude/settings.json` and `.agents/hooks/**`,
so an agent cannot quietly disable its own guardrails.

**14 · Merges add only what is missing.** A handler is added only where no equivalent handler
(the same script) already covers the event and tool — a project whose guard runs on `Bash`
gains `PowerShell` coverage instead of a duplicate guard — and everything added is recorded, so
`update` and `uninstall` remove exactly that. A handler the user deleted is not re-added.

## Enforcement beyond Claude Code

**15 · "Enforced" must say for whom.** A register listing "production never moves on an agent's
initiative" as enforced, while Codex, Cursor or a person could push to `main` unopposed, is the
overstated-coverage failure the register exists to prevent. Branch protection on the git host
(required pull requests and checks) holds it for everyone; the enforcement method records the
**coverage** of every mechanism and lists an unprotected production branch as a gap. Up to 2.x
the kit also installed a per-clone pre-commit/pre-push guard: it rebuilt, bypassably and once per
clone, what the host does for everyone, so 3.0 removed it — `setup-clone.mjs` takes it out of
any clone that still has it. `guard-git` stays: the host stops a push, not the local damage
before it (discarded work, a commit or branch cut on production, a hook bypass), and many
repositories have no server-side protection at all. On a trunk, a pull request into it is the
normal path, so `gh pr create --base <trunk>` passes; only a separate production branch is a
release.

## Schema

**16 · Examples pass their own schema.** Keys starting with `_` (`_comment`, `_provisional`) are
allowed at every level; a schema with `additionalProperties: false` at the root rejected the
shipped examples.

**17 · One config root.** The loader and the schema agree on `.agents/sdlc.config.json`; the
pre-2.0 `.claude/sdlc.config.json` (until `update` moves it) and a legacy `.ai/sdlc.config.json`
are still read.

**18 · Fields:** `branching.hotfixPrefix`, `gates[].timeoutMs` (an inconclusive gate fails
closed), the guard settings above, and the `workflow` switches (below).

## Method and templates

**19 · The install procedure is a skill.** `sdlc-init` runs in a forked context — a survey reads
far more than the main conversation should hold — and the `/sdlc-init` the hooks mention
resolves.

**20 · Generate, don't copy — refined.** Copying a ready-made `.claude/` into repositories fails:
in one measured case 10 of 18 copied files diverged within a session, each a legitimate
adaptation. The drift was repo-specific knowledge living in copied files. The kit separates the
two: **universal, config-driven** assets (the hooks, `deliver`, `gates`, `ship-it`, `handoff`,
the admin skills, the review agents, the domain skills) are kit-owned and replaced on update,
while **repo-specific** knowledge is generated into overlays (`.agents/overlays/<skill>.md`),
project skills and the config. `sdlc-init` writes the first overlays from its survey.

**21 · Templates are consistent with the code — and few.** They name the real config path,
document the current hook layers and which agents each covers, and include `docs/lessons.md`.
Up to 2.x `sdlc-init` also generated ten SDLC phase documents, six role briefs, a vision and
four domain documents; agents did not load them unprompted and people did not read them, and
the domain ones repeated what the skill overlays carry. 3.0 keeps `project`, `rules`,
`critical-infrastructure`, `lessons` and the ADR index; area knowledge goes in the overlays. References to skills and agents the kit does not ship name the ones it does. The ADR
template — with **Deciders**, a quality-attribute scenario table and a strict **Compliance**
section — is the only one in the kit; the `architecture` skill uses the same file.

## Measurement and workflow hooks

**22 · The workflow is measured.** Hooks read the session transcript through one shared parser
(`_transcript.mjs`, which the CLI imports too): `session-eval` records one row of facts per
context window — its one-line summary at `SessionStart` is opt-in (`workflow.sessionSummary`):
the numbers are the admin's, read with `agent-setup evals`; `stop-check` blocks the end of a turn once when code changed after the
last passing check — a command the permission system or a hook refused never counts as a
check — or when risky work changed and no reviewer agent looked at it (rule 23b); `context-budget` reads the window's size to keep it short (rule 23e). `gateCommands()`
makes a project's own gate commands count as checks. For `stop-check`, work a subagent did is
work done in the conversation: it reads each run's own transcript, so code the implementer
changed counts as an edit, a check the implementer ran after its own last edit counts as the
check, and a run in the background counts from its completion notice. Without that, the build
the deliver skill hands down escaped both asks.

**23 · A risky request becomes a task before work starts.** `prompt-intake` (its rubric in
`_prompt.mjs`, shared with the rows and the CLI) asks the agent to restate a large or risky
task prompt — auth, payments, data, production, secrets — as a brief (goal, scope, acceptance,
assumptions, risks) before its first edit. It is a trigger, not a toll: up to 2.x it also fired
on vague small prompts, held the first edit back until a brief existed and coached the developer
once per session, and on ordinary work that read as the tool getting in the way. A vague small
request is cheap to correct and is the `deliver` skill's to brief when it loads. The admin's
reminders (lessons waiting, a retro due after `workflow.retroEvery` windows) moved from every
session start to `agent-setup report`.

**23a · Work a cheaper model does as well is handed to it.** The same hook adds one line when a
task is documentation (the `doc-writer`, low tier) or a plan of three or more steps to build (the
`implementer`, medium tier), and the agent is installed. Measured on real runs: a top model
given either does it itself, whatever the agents' descriptions and AGENTS.md say, and a polite
"hand it to…" inside the brief note was ignored too; an imperative line, first in the note
("do not write these docs yourself: delegate them now…"), moved it — docs to the doc-writer,
each plan step to the implementer. It stays narrow — a code change that also mentions the
README is not a docs task — because a false routing costs a cold start and a note on every
prompt teaches everyone to skim. Plans and reviews go up a tier through the agents' own models
and the deliver skill, which already happen; the hook only handles the way down.

**23b · Risky work is reviewed before it is called done.** `stop-check` asks, in the same single
block as the check, for the security-reviewer (or the code-reviewer where it is the one
installed) when a task prompt in the window was risky by the intake's test and code changed,
and no reviewer agent ran after the first edit. Measured: a session running on Sonnet read the
intake's "have the security-reviewer check the change" and finished without it; at the stop it
ran the review, which led to two fixes. Counted from the first edit, so fixing a review's
findings never asks for a second review; once per edit, like the check.

**23c · A pull request per task, when the team wants one.** With `workflow.pullRequests:
"per-task"` every change is its own pull request: a branch and a draft PR before the first edit,
so the team sees what is being worked on; verified and reviewed; merged when green and its
branch deleted, so nothing is left behind. It is opt-in because it costs a branch, a PR and a CI
run for a one-line fix, and needs a host CLI — the default stays rule 12's cheap guess. The
procedure is the `ship-it` skill's; three hooks hold it. `prompt-intake` says it when a task
arrives while the agent stands on the integration branch — the cycle starts before the first
edit, so the session start is too early and the stop too late — and only there: on a feature
branch it is under way. `guard-git` denies a commit on, or a push to, the integration branch,
naming the branch to cut; uncommitted edits move with `git switch -c`, so an agent that started
on the wrong branch loses nothing. `branch-check` flags a branch whose PR was merged since, the
loose end of a merge that was queued. The agent merges its own PR when the gates, the review and
the PR's checks are green — through the host's rules, never `--admin`, so an approval the host
requires still holds it; `askMerge: true` makes it ask first, for a trunk where a merge deploys.
Squash merges fold the empty start commit away, and the host's automatic branch deletion keeps
the remote clean: `sdlc-init` checks both.

**23d · The session orchestrates, on the strongest model the account has.** Unless the team
chose a model, Claude Code sessions start on `best` — Fable where the account has it, Opus
otherwise — the `orchestrator` in `kit/models.json`, the first row of the AGENTS.md tier
table. Its judgement is spent where a weaker model's mistakes cost the most: the brief, the
plan's decisions, routing each step, reading what comes back. It is also the dearest token in
the session, re-read on every call, so the rest of the layer exists to keep it lean: the
routing notes (23a), the deliver skill's table, and the window kept short (23e). A team that
wants the cheaper setup names it once (`--session-model opusplan`); `usage` shows which pays.

**23e · A long window ends at the end of a task.** Every call re-reads the whole window, and an
old task's reading left in it pulls the next one off course. The agent cannot clear its own
window; the person can, and knows when the task is done. So `context-budget` speaks to each in
turn: past `workflow.contextWarnTokens` (once per band), the agent is told to delegate, read
narrowly and leave a handoff when work will remain; at the end of that turn the person gets one
line — `/clear` once the task is done, `/handoff` first if it continues — as a systemMessage the
model never reads, and not at all when the agent's own last message already said it. After
`/clear`, a handoff written in the last six hours is pointed out, so "continue" costs nothing to
find. Not `/compact`: a summary keeps the old task's direction in the window.

**23f · What the workflow runs again and again is approved once.** A prompt mid-task stops the
person and the work; in auto mode the same command costs a classifier round-trip. The install
allows the gates in `sdlc.config.json` (a rule per part of a compound command; none for a
command holding a wildcard, an expansion or a redirect, and a single word stays exact: `make *`
would approve every target), reading git and the pull request, and — only where `guard-git` runs,
because it denies their destructive forms first — `git add`, `commit`, `switch`, `checkout -b`
and `pull --ff-only`. Pushing still asks: it leaves the machine. No permission mode is set:
`auto` is ignored from a project's settings, and any project value would outrank the auto mode
each person starts in.

**24 · The switches.** `workflow` in `sdlc.config.json`: `verifyBeforeStop`,
`contextWarnTokens`, `promptIntake` and `retroEvery` (on by default), `sessionSummary`,
`askBranch` and `askMerge` (off), `pullRequests` (`on-request`; `per-task` is rule 23c). The
schema documents each.
