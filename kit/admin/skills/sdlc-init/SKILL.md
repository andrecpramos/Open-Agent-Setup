---
name: sdlc-init
description: >
  Set up or refresh this repository's SDLC contract for AI agents — survey the tree and CI,
  write or verify .agents/sdlc.config.json (branch model, gates exactly as CI runs them,
  guards, post-edit checks), write the knowledge base (.agents/docs and the ADR folder) from
  templates, fill the project section of AGENTS.md, write the first skill overlays, generate
  only the repo-specific skills and agents that are justified, and report what is claimed but
  not enforced. Admin role, run by name. Use after installing Agent_Setup, for
  "/sdlc-init", "set up the SDLC", "fill in AGENTS.md", or when the session start says the
  sdlc config is missing or provisional.
compatibility: "In Claude Code this skill runs in a forked context; other agents run it inline, which works but fills the current context. The forking keys (context, agent, background) are Claude Code-only, so agent-setup export removes them for claude.ai upload and strict Agent Skills validators."
context: fork
agent: general-purpose
background: false
disable-model-invocation: true
---

# SDLC bootstrap

The binding install procedure. It surveys what is already
there, generates what is missing, and — most valuable — reports what is *claimed* but not
*enforced*. The Agent_Setup installer has already put the kit's skills, agents and hooks in
place with a **provisional** config; this procedure makes the contract true for this repo.

Three principles carry through every phase:

- **Detected, asked or assumed.** Mark every value. A `TODO` is correct output; an invented
  value is not — an invented threshold becomes a cited fact within a week.
- **Adopt, never replace.** Existing docs, conventions and SDLC are adopted into the config and
  templates, including the ones you would not have chosen.
- **Non-destructive.** Never overwrite an existing file. A collision is written as
  `<name>.kit.md` beside the original and listed in the report.

Read `.agents/overlays/sdlc-init.md` first if it exists; it wins where it disagrees with this file.

## Phase 1 — Survey. Read before writing.

```bash
git symbolic-ref refs/remotes/origin/HEAD; git branch -a; git log --oneline -20
ls package.json pnpm-lock.yaml yarn.lock go.mod Cargo.toml pyproject.toml pom.xml build.gradle* *.sln
ls .github/workflows/ .gitlab-ci.yml Jenkinsfile azure-pipelines.yml
ls AGENTS.md CLAUDE.md GEMINI.md .cursorrules .github/copilot-instructions.md CONTRIBUTING.md README.md
ls .agents/ .claude/ .ai/ docs/ adr/ decisions/
cat .agents/agent-setup.json .agents/sdlc.config.json
```

(PowerShell: `Get-ChildItem` with the same names.) Then **read the CI steps** — job names are
marketing; the `run:` lines are the truth. A job called "test" that runs `echo ok` is a finding,
not a gate.

Answer, marking each **detected / asked / assumed**:

| Question | Notes |
|---|---|
| Production branch, integration branch, model | From real merge patterns, not intent. The provisional config is a guess from branch names — verify it |
| Package manager, runtime, minimum version that actually works | Manifests lie; check `.nvmrc`, `.tool-versions`, CI |
| Every command CI runs | Character for character |
| Which of those **block a merge** | Needs branch protection — check it (`gh api repos/{owner}/{repo}/branches/{branch}/protection`); see [references/enforcement.md](../enforcement-audit/references/enforcement.md) |
| Test runner, typechecker, linter **invoked by a script** | A config file nobody runs is not a gate |
| Existing docs and agent instructions | Adopted, never replaced |
| Is the tree shared by concurrent sessions? | **Ask the user** — it changes what gets denied. In a forked run, record it as an open question |
| Is the production branch protected on the git host? | Required pull requests and checks hold the contract for every agent and person; the Claude Code hooks hold it only in Claude Code sessions. Unprotected → a gap in the register |
| Should every change be its own pull request? | **Ask the user.** Yes → `workflow.pullRequests: "per-task"`: a draft PR before the first edit, merged and its branch deleted at the end. Ask too whether the agent merges when green or asks first (`askMerge: true` — say so where a merge deploys). Then check the host: `gh api repos/{owner}/{repo} --jq '{squash: .allow_squash_merge, autoMerge: .allow_auto_merge, deleteBranch: .delete_branch_on_merge}'`. Squash off leaves each task's start commit in history; branch deletion off leaves merged branches behind — each is a gap for the report |
| What does this repo know that an agent would get wrong? | The most important question. It drives Phase 3's overlays and skills |

Classify: **greenfield** (install everything) · **brownfield** (fill gaps, adopt the rest) ·
**contested** (an SDLC exists and disagrees with the kit — adopt the repo's model; the kit's
defaults are defaults, not requirements).

## Phase 2 — Write `.agents/sdlc.config.json`

Validate against [assets/sdlc.config.schema.json](assets/sdlc.config.schema.json); worked
examples in `assets/examples/`. The file is protected — the user approves the write.

- **Every `gates[].command` is exactly what CI runs.** Not an equivalent, not a tidier
  version. If CI runs `pnpm -r test` and you write `pnpm test`, `/gates` passes locally and CI
  fails — and the first time that happens, people stop running `/gates`.
- **`blocking` says whether a failure stops the work.** Every pass/fail check CI runs is
  `"blocking": true`: a failing test is a failure whether or not the git host enforces it.
  `false` is for a check the project lets fail — `continue-on-error`, `allow_failure`, an audit
  everyone knows is red. An advisory check marked blocking is how people stop running `/gates`;
  a real check marked advisory is how a red test gets committed, because `/gates` then says
  MERGE-SAFE.
- **Whether the host enforces a gate is a separate fact.** Check the branch protection or
  rulesets that require it, and record the result in `critical-infrastructure.md`: `enforced`,
  or `partial` when nothing requires it or you could not check (no remote, no `gh`, a 403).
  Never turn a gate advisory because its enforcement is unverified.
- Order `gates` cheapest first. Keep `postEdit` commands under a second.
- Remove `_provisional` only once branches and gates are verified.

## Phase 3 — Generate

**Knowledge base** — from [assets/templates/](assets/templates/) into `.agents/docs/` and
`.agents/decisions/` (or the `docs.root` the repo uses): `project.md`, `rules.md`,
`critical-infrastructure.md`, `lessons.md` and the ADR index — nothing more. Knowledge about an
area (architecture, security, testing conventions) goes in that skill's overlay below, where
the agent reads it while working there, not in a document beside it.

- Replace every `{{PLACEHOLDER}}` with a surveyed value, **or** delete the section and leave a
  one-line `TODO:` naming what is missing and who can answer it.
- Resolve every `> **Survey:**` block, or mark the document `Status: incomplete`.
- **Delete sections that do not apply.** A mobile-release section in a library repo makes the
  document look like boilerplate, and boilerplate stops being read.
- Never invent thresholds, coverage targets, latency budgets, SLAs, device matrices or roles.

**AGENTS.md project section** — replace each `TODO(sdlc-init)` with verified facts: one
paragraph on what this is; the exact commands (install, dev, build, test, **a single test**,
lint, typecheck) checked against CI; the handful of conventions a newcomer would get wrong.
Keep everything outside the managed block short — it loads into every session of every agent.
Never edit inside `<!-- agent-setup:begin/end -->`.

**Skill overlays** — for each installed kit skill where the survey found repo-specific
knowledge, write `.agents/overlays/<skill>.md` with **only** that knowledge: where things live,
which library the repo uses for X, the exact commands, the conventions and the traps. No
overlay for a skill with nothing specific to say. This is "generate, don't copy" applied to the
kit: the universal skill stays shared; the repo's knowledge lives beside it. One overlay is
almost always worth writing: `.agents/overlays/deliver.md` — which paths are risky here (and so
always get the security reviewer), how acceptance is usually proven in this repo (the test
runner, an e2e suite, a preview deploy), and anything the team wants in every brief.

**Workflow assets** — follow [references/workflow.md](references/workflow.md). The kit already
provides the universal, config-driven ones (`deliver`, `gates`, `ship-it`, `handoff`,
`enforcement-audit`, `code-reviewer`, `gate-runner`, `docs-keeper`); do not generate copies. Generate a project skill or agent only
when it encodes something *this repo knows that a competent agent would otherwise get wrong*.

**Harvest what the repo already learned** — plan documents, post-mortems, gotchas and
`// never do X` comments go into `.agents/docs/lessons.md`, and each is pushed up the ladder
where possible: a `postEdit` reminder, a `guard.extraDeny`, a gate.

## Phase 4 — Verify. No success report without this.

```bash
node -e "JSON.parse(require('fs').readFileSync('.agents/sdlc.config.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
node .agents/skills/gates/scripts/run-gates.mjs --all
```

Hook smoke tests: write each payload to a **file** and pipe the file (an echoed payload that
contains `git push origin main` is itself a command the guard inspects):

```bash
node -e "require('fs').writeFileSync('/tmp/p.json', JSON.stringify({hook_event_name:'SessionStart',source:'startup'}))"
node .agents/hooks/branch-check.mjs < /tmp/p.json     # exit 0, valid JSON
echo not-json | node .agents/hooks/branch-check.mjs  # exit 0, fails open
```

Every hook must exit 0 and print valid JSON or nothing. On a previously ungated repo `/gates`
is *expected* to fail — that failure is the baseline and belongs in the report.

## Phase 5 — Report

1. **Installed and generated** — each file, and for each generated skill, agent or overlay
   *what repo-specific knowledge it encodes*. If you cannot name that, delete it first.
2. **The config** — branch model and gate list, each value marked detected / asked / assumed.
3. **Gaps, ranked** — every rule claimed and enforced by nothing, blast radius first, using
   [references/enforcement.md](../enforcement-audit/references/enforcement.md). **This is the deliverable.**
4. **Open questions** — what only the user can answer (shared tree? other agents? which CI
   jobs are required? a pull request per task?). Ask now, not later.

End with **one** next action: the cheapest fix with the largest blast radius, as a command or
a file. Not a list — a list gets deferred.

## Improving an SDLC that already exists

A different job from installing: **adopt, then audit — never overwrite.** Write the repo's real
conventions into the config (including ones you would not have chosen); find each stated rule's
enforcement; close **one** gap and make it fail on purpose to prove it fires; leave the rest
documented and ranked. A ranked, honest gap list beats six half-wired gates.
