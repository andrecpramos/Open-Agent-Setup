# Architecture of Agent_Setup

## Contents

1. What it is made of
2. The ownership model
3. What an install writes
4. install / update / uninstall
5. Vendoring and the copy-a-folder routes
6. Which agents get what
7. Enforcement layers
8. Files and formats

## 1 · What it is made of

One kit, one place per theme. The authoritative map is the Layout tables in
[AGENTS.md](../AGENTS.md); `agent-setup lint` fails when the tree and those tables disagree.

```
Agent_Setup/
├── src/lib/*.mts             the CLI's TypeScript source (strict); scripts/build.mjs emits lib/*.mjs
├── src/bin/*.mts             the CLI entry point source; emits bin/agent-setup.mjs
├── src/tests/*.mts           the test sources (node:test); emits tests/*.test.mjs
├── bin/agent-setup.mjs        the CLI (Node 18+, zero runtime dependencies; build output, never hand-edit)
├── lib/                       CLI modules: sync (install/update), models (the tiers, other tools' agent files), vendor, export, routing (routing, trigger and delegation evals), outcomes (the kit against vanilla), evals (the summary rows), usage (cost and routing savings), report (the weekly cycle), lint, settings merge, blocks, detect (build output)
├── scripts/                   build.mjs (typecheck with tsc, emit to lib/ and bin/) and test.mjs (every suite, on Node 18+)
├── tsconfig.json              strict TS config for src/ (typescript + @types/node are dev-only)
├── kit/                       THE PAYLOAD — what an install copies into a project
│   ├── developer/             the developer role
│   │   ├── skills/            13 skills — domain, the delivery workflow, the two design skills (own and vendored side by side)
│   │   ├── agents/            8 subagents, each on a model tier — scout, planner, implementer, gate runner, the review team (code, security, architecture), doc writer
│   │   └── licenses/          one licence per upstream source of the vendored skills
│   ├── admin/                 the admin role
│   │   ├── skills/            sdlc-init, self-improve, enforcement-audit — run by name only
│   │   └── agents/            docs-keeper
│   ├── catalog.json           the roles, each skill's group (domain · core · design · admin), the agents and their tiers, each hook's role, the profiles
│   ├── models.json            the model tiers: each provider's model and effort per tier, and every model's price
│   ├── vendor.json            the vendored skills, every local override with its why, the upstream skills left out
│   ├── vendor.lock.json       the exact upstream commits
│   ├── hooks/                 the runtime hooks of both roles and setup-clone; _transcript.mjs, _prompt.mjs and _usage.mjs are shared with the CLI
│   ├── templates/             AGENTS.md, managed blocks and the Claude Code section, the team guide (.agents/WORKFLOW.md), learnings and overlay scaffolds
│   └── settings.fragment.json hook wiring and permissions merged into a project
├── inbox/                     kit-improvement proposals harvested from projects
├── scorecards/                eval results: <suite>.latest.json (eval-routing / eval-outcomes --save) and <suite>.baseline.json
├── .github/workflows/         CI: npm run check and evals --check
├── docs/                      this folder; maintaining/ holds the harvest and release procedures
├── tests/                     node --test suites for hooks, CLI, vendoring and routing
└── LICENSE                    MIT — installed with every project and exported with every own skill
```

**Roles.** The kit is split by who uses it. The **developer** role (`kit/developer/`) is
what developers' agents use day to day and is always installed. The **admin** role
(`kit/admin/`) is for whoever sets the kit up and keeps it improving: its skills set
`disable-model-invocation: true`, so in Claude Code they run only when invoked by name and
their descriptions never enter a developer's session; its hooks (`session-eval`,
`learning-signals`, `context-budget`) are sensors. `--roles developer` leaves the whole
role out. A skill's or agent's role is the folder it lives in; a hook's role is recorded in the
catalog, because the hooks share one runtime folder (`_config.mjs`) and install as one. In a
project every skill sits in one flat `.agents/skills/`, which is what agents read.

**Skill groups.** `domain` (seven engineering skills written here), `core` (the delivery
workflow — `deliver` and the skills it sequences — installed in every project), `design` (two
vendored skills for UI build direction and browser verification, opt-in) and `admin` (the
admin role's skills). Profiles select by name or by `@group`.

## 2 · The ownership model

The design problem: copying a ready-made `.claude/` into repos fails — in one measured case
10 of 18 copied files diverged within one session, each a legitimate adaptation. Yet a kit
that ships no skills cannot carry expertise between projects. The resolution is to separate
knowledge by **who owns it**:

| Layer | Examples | Owner | Update behaviour |
|---|---|---|---|
| **Kit-owned** | skills, licences, agents, hooks, the learnings/overlays READMEs | the kit | hashed in the project manifest; replaced on `update` only while unmodified; a local modification is kept and the new version written beside it as `.kit-new` |
| **Managed blocks** | the `agent-setup:begin/end` sections of AGENTS.md, CLAUDE.md, GEMINI.md, .gitignore | the kit, inside the markers | rewritten on every update; everything outside the markers is the project's |
| **Project-owned** | `sdlc.config.json`, `.agents/docs/`, decisions, overlays, learnings, project skills | the project | created once if absent (from templates or by `sdlc-init`); never touched again by the kit |
| **Per clone** | Claude Code's `.claude/skills/` links | each clone | not in git at all; recorded in the manifest, created by `.agents/hooks/setup-clone.mjs` |

Kit skills are written to be repo-agnostic: whatever a skill needs to know about *this*
repository it reads from `sdlc.config.json`, the knowledge base and — above all —
`.agents/overlays/<skill>.md`, which every own skill reads before starting and which wins
where it disagrees. The part that used to drift now has a home of its own. Vendored skills
have no overlay line (they are never edited); the `frontend` overlay says how they apply.

## 3 · What an install writes

```
<project>/
├── AGENTS.md                  created from template (or a managed block appended) — every agent reads it
├── CLAUDE.md                  only if the project has one: a managed block importing AGENTS.md
├── GEMINI.md                  managed block: @./AGENTS.md  (--targets …,gemini)
├── .gitignore                 managed block: local agent state (and, for Claude Code, its links and personal files)
├── .agents/                   the home — committed, the same for every agent
│   ├── agent-setup.json       manifest: kit version + source, selection, file hashes, links, what was added
│   ├── sdlc.config.json       provisional contract from git (project-owned; /sdlc-init verifies)
│   ├── README.md              what this folder is: each part, who edits it, how to remove it all
│   ├── WORKFLOW.md            the developers' one-page guide
│   ├── models.json            the model tiers and prices (the session recorder and `usage` price sessions with them)
│   ├── skills/<skill>/        the one copy of each selected skill (evals stay in the kit)
│   ├── licenses/<source>.txt  the kit's notice, and the licence of each upstream source a selected skill comes from
│   ├── agents/*.md            the agents as procedures (without the claude target)
│   ├── hooks/*.mjs            setup-clone.mjs (always); with the claude target, the runtime hooks of the installed roles
│   ├── learnings/             admin role: inbox.md, README.md, (archive/, outbox/, signals.jsonl, live-session.json, eval-windows.jsonl later)
│   └── overlays/README.md     how to adapt a skill without forking it
└── .claude/                   only with the claude target
    ├── settings.json          hooks (exec form, run from .agents/hooks/) and permissions, merged
    ├── agents/*.md            the kit subagents, where Claude Code reads them (each names its tier's model)
    ├── skills/<skill>  →      per clone, git-ignored: link to .agents/skills/<skill>
    └── licenses        →      per clone, git-ignored: link to .agents/licenses (when a vendored skill is installed)
```

**The claude target** is chosen when the project already has `.claude/` or a `CLAUDE.md`, or
with `--targets agents,claude`; `--setup measure` always takes it (the recorder is a Claude Code
hook). Without it nothing vendor-specific is written: no `.claude/`, no `CLAUDE.md`, no runtime
hooks — the install prints the command that adds them.

**Why links, not a second copy.** Claude Code reads project skills only from `.claude/skills/`;
the Agent Skills readers read `.agents/skills/`. Two copies doubled every skill in the
repository and drifted the moment one was edited. Links cost nothing, but they cannot be
committed: git on Windows walks through a junction and commits its contents a second time. So
the manifest records the links, `.gitignore` lists them, and `setup-clone.mjs` creates them in
each clone — junctions on Windows (no admin rights needed), relative symlinks elsewhere — and
Claude Code's first session-start handler runs it with `--hook`, so a fresh clone links itself
and says to `/reload-skills`. It removes them with unlink, never a recursive delete, which
through a junction would reach the real files.

**Why no CLAUDE.md.** Claude Code reads `AGENTS.md` when there is no `CLAUDE.md`, and only
`CLAUDE.md` when there is one. So the kit never creates it — the Claude Code section lives in
AGENTS.md's managed block — and a project's own `CLAUDE.md` gets a block with `@AGENTS.md`.

**Why no git hooks.** Installs before 3.0 could add a pre-commit/pre-push guard to every clone.
It rebuilt, per clone and bypassably, what branch protection on the git host does for everyone,
so it is gone: `setup-clone.mjs` removes it from any clone that still has it (and Claude Code's
session start runs that), and `update` says so once.

## 4 · install / update / uninstall

`install` and `update` are one function (`lib/sync.mjs`) that makes a project match the desired
state for its selection:

1. **Resolve the selection** — roles (developer always; admin unless `--roles developer`) +
   profile (on a first install without `--profile`, the one that fits what the project contains;
   recorded, so updates keep it) + `--skills`/`--exclude` (names or `@group`) + targets. The
   `core` list is always included, and every admin skill with the admin role; agents come with
   the skills they require; hooks with their role. A name an older manifest lists that the kit no
   longer has is dropped, with a note.
2. **Detect collisions** — a skill or agent of the same name that the project owns is skipped
   and reported, never overwritten.
   An install from before 2.0 (manifest in `.claude/`) is migrated first: its old
   `.agents/` links are unlinked, the project's own `sdlc.config.json`, learnings, overlays,
   docs and decisions move to `.agents/` (never over a file already there), and the kit files
   left in `.claude/` are then reconciled like any file no longer desired — removed while
   unmodified, kept and reported otherwise. Hook handlers the user removed stay removed.
3. **Reconcile kit-owned files** against the manifest:
   - recorded and unmodified → replaced if the kit's version changed;
   - recorded and modified → kept, kit version written as `<file>.kit-new`;
   - recorded and missing → restored;
   - new → written, unless a different file is already there (then `.kit-new`);
   - no longer desired → removed if unmodified, otherwise kept and reported.
4. **Merge settings** — remove what the previous run added, re-merge the current fragment,
   skip handlers the user deleted on purpose (per event). With `--session-model`, the `model`
   every session starts on is set too — only where the project's settings choose none, removed
   only while it is still the kit's, and not put back once someone deleted it.
5. **Write managed blocks** and create project-owned files that are missing.
6. **Write the manifest, register the project** in `~/.agent-setup/projects.json` (per user,
   so moving or re-cloning the kit orphans nothing; a registry an older checkout kept in its
   `.state/` is read until the first write) so `update --all`, `status --all`, `harvest`,
   `evals` and `report` can find it, **and run `setup-clone.mjs`** for
   this clone's links.

Line endings are normalised before hashing, so `core.autocrlf` never makes a file look
modified. `uninstall` first runs `setup-clone.mjs --uninstall` (the links), then
reverses exactly the manifest: unmodified kit files, managed blocks, added settings; files
created from templates are deleted only if unchanged.

## 5 · Vendoring and the copy-a-folder routes

Everything that comes from elsewhere is recorded in `kit/vendor.json`: third-party skills
copied verbatim from GitHub (`design-taste-frontend` from taste-skill, `agent-browser`). They serve
the developer role: the kit keeps the skill folders in `kit/developer/skills/`, the commit in
`vendor.lock.json` and one licence per source in `kit/developer/licenses/`; `agent-setup vendor sync` rebuilds them
(`--locked` rebuilds the recorded commits exactly) and `vendor status` reports upstream moves.
Only sources whose licence allows redistribution are vendored. Everything else in the kit —
the SDLC layer included ([SDLC.md](SDLC.md)) — is written and maintained here.

A vendored skill is never edited by hand: the only local changes are frontmatter overrides
(`description`, `compatibility`, `removeKeys`) in `vendor.json`, each with a `why`, re-applied
on every sync. The sync fails if any vendored skill breaks the Agent Skills spec, removes
skills dropped from the manifest, and warns when an upstream repository adds a skill that is
neither vendored nor excluded (an exclusion carries its `why`, like an override). `agent-setup import
<github-url>` adds a new source and syncs it.

**Routes that copy one skill folder at a time** — `npx skills add` (any agent, per project or
per user) and claude.ai upload — cannot reach `kit/developer/licenses/`, and MIT and Apache-2.0 require
the notice to travel with every copy. They install from `agent-setup export <dir>` instead:
build output, written outside the kit, in which every skill folder carries its LICENSE — the
upstream's for a vendored skill, the kit's MIT
licence for its own — every reference points at that copy, and frontmatter keys outside the
Agent Skills spec are removed. An install does the same once per project: the kit's notice in
`.agents/licenses/agent-setup.txt`, each upstream's beside it. The kit itself stays one copy; the
export checks its own result (spec valid, no reference left to `../../licenses/`) and fails
rather than write an incomplete one.

## 6 · Which agents get what

| | Claude Code | Codex · Cursor · Copilot · Gemini CLI · others |
|---|---|---|
| Instructions | `AGENTS.md`, read natively (a project's own `CLAUDE.md` imports it) | `AGENTS.md` (Gemini: `GEMINI.md` → `@./AGENTS.md`) |
| Skills | `.claude/skills/` links to `.agents/skills/` (auto-selected by description) | `.agents/skills/` (Agent Skills readers); any agent can open a `SKILL.md` as AGENTS.md instructs |
| Subagents | `.claude/agents/`, each on its tier's model alias and effort | Codex: `.codex/agents/<name>.toml`, the same agents on the OpenAI model of their tier. Others: `.agents/agents/` as procedures to follow inline (each reviewer's checklist also lives in its skill) |
| Model tiers | the agents' `model`/`effort`; the AGENTS.md tier table for its own routing | the AGENTS.md table, with the column of each targeted provider (all of them for tools that run any provider's models) |
| Guards | Claude Code hooks (Bash and PowerShell tools) + branch protection on the host | the same hooks through `run-hook.mjs` in Codex, Cursor, Copilot, Antigravity and Windsurf (below); branch protection on the host; AGENTS.md instructions |
| Admin skills | invoked by name only (`disable-model-invocation`): no context cost | ordinary skills (the key is ignored) |
| Learning signals | hooks (corrections, friction) | AGENTS.md instructions |

Portability rules for skills: developer skills use the portable frontmatter (`name`,
`description`). Claude-only keys appear only in the admin skills, where they add real value:
`disable-model-invocation` (all three) and `context: fork` (`sdlc-init`,
`enforcement-audit`). Other agents ignore them and run those skills inline; claude.ai upload
and strict validators reject them, so `export` removes them. Vendored skills are patched to the
Agent Skills spec by their overrides. Skills name no single vendor's tools and link each other
by relative path, so they work in agents without skill auto-loading. For
tools with their own skill folders (Windsurf, Roo, Kiro, Goose), `npx skills add <export> -a
<agent>` installs the same skills from an export.

**Model tiers.** `kit/models.json` is the one place for models: four tiers (frontier, high,
medium, low), the model and reasoning effort each provider runs a tier on, and every model's
price, with its source and the date it was checked. Each agent names its tier in the catalog;
lint holds its Claude Code file to the tier's alias and effort, the installer renders the same
agent for Codex on the tier's OpenAI model, and the AGENTS.md block gets the table with the
routing rule (size first; down for searching, building and docs, up for plans and reviews;
escalate on evidence). Claude Code needs no rendering: its aliases resolve per provider, and a
project re-points one with `ANTHROPIC_DEFAULT_*_MODEL`. A project's `models` section in
`sdlc.config.json` overrides prices and tier models without touching the kit's copy; the next
`update` re-renders what depends on it. Gemini CLI's subagents are experimental and Copilot
names models by display name, so both get the table, not agent files.

**What it cost.** The session recorder keeps each window's tokens per model, the 1-hour cache
writes apart from the 5-minute ones, and — read from each subagent's own transcript
(`<session>/subagents/agent-<id>.jsonl`) — every run's tokens by agent type.
`kit/hooks/_usage.mjs` prices them with the project's table and prints the report
(`agent-setup usage`, or `session-eval.mjs --usage` in the project): cost per model and tier,
each subagent run priced again on its window's main model (saved by delegating down, paid for
escalating up), the total against one reference model, and the quality metrics of routed windows
beside the rest. On a Claude Code session it lands within rounding of Claude Code's own cost
figure, which it prints beside it.

**Hooks in other agents.** Codex (`.codex/hooks.json`), Cursor (`.cursor/hooks.json`), GitHub
Copilot (`.github/hooks/agent-setup.json`, a file of the kit's own), Antigravity (a named set in
`.agents/hooks.json`) and Windsurf (`.windsurf/hooks.json`) each get entries that run
`node .agents/hooks/run-hook.mjs <agent> <hook>`. It translates the agent's payload into the
one the hooks speak and the answer back, so every rule exists once. The installer merges the
entries into a file the project already has, records what it added (`agentHooks` in the
manifest, with the entries a person removed, which stay removed until `--reset-hooks`), and
takes exactly those out again on uninstall or when the target is dropped; a file that held
nothing else goes. Each agent gets what its events allow:

| Hook | Codex | Cursor | Copilot | Antigravity | Windsurf |
|---|---|---|---|---|---|
| guard-git | PreToolUse `Bash` | beforeShellExecution | preToolUse (`bash`, `powershell`) | PreToolUse `run_command` | pre_run_command (exit 2) |
| check-gates | PostToolUse `apply_patch` (each file in the patch) | postToolUse `Write` | postToolUse (`edit`, `create`) | — | — |
| branch-check | SessionStart | sessionStart | sessionStart | — | — |
| prompt-intake, learning-signals | UserPromptSubmit | — (no context on a prompt) | — (prompt hooks' output is dropped) | — | — |

Targets default to the agents the project shows: `.claude/` or `CLAUDE.md`; `.codex/`;
`.cursor/` or `.cursorrules`; `.github/copilot-instructions.md` and Copilot's other `.github/`
folders; `.agents/rules/`, `.agents/workflows/`, `.gemini/` or `GEMINI.md` (Antigravity);
`.windsurf/`, `.windsurfrules` or `.devin/`.

## 7 · Enforcement layers

| Layer | Fires | Covers |
|---|---|---|
| `branch-check` (SessionStart) | a new context window whose branch needs attention (production, detached, stale, a wrong config) | Claude Code |
| `guard-git` (PreToolUse) | before a shell command runs | Claude Code (Bash, PowerShell) |
| `check-gates` (PostToolUse) | after an edit to a configured path | Claude Code |
| `prompt-intake` (UserPromptSubmit) | a large or risky task prompt (auth, payments, data, production, secrets): asks for a brief (goal, scope, acceptance, assumptions, risks) before the first edit; a documentation task or a plan of three or more steps to build: names the cheaper agent to hand it to (doc-writer, implementer); silent otherwise | Claude Code |
| `learning-signals` (admin) | user prompt (corrections), tool failure (friction); at session start only the live-session pointer | Claude Code |
| `session-eval` (admin; PreCompact, SessionEnd, SessionStart) | at the end of every context window it records facts; the session-start summary line is opt-in (`workflow.sessionSummary`); blocks nothing | Claude Code |
| `stop-check` (Stop) | when a turn ends with code changed after the last passing check, or with risky work (the intake's test) changed and no reviewer agent run on it: blocks once per edit — a subagent's edits and checks, read from its own transcript, count as the conversation's | Claude Code |
| `run-hook` | the guard, the post-edit check, the branch note and the brief in other agents, as their events allow (§6) | Codex, Cursor, Copilot, Antigravity, Windsurf |
| `context-budget` (admin; UserPromptSubmit) | when the context window passes each multiple of the budget: one note to the agent | Claude Code |
| gates in CI + branch protection | before merge | everyone |

The enforcement register (`enforcement-audit`) records, for each rule, which of these hold it.

## 8 · Files and formats

- **Manifest** (`.agents/agent-setup.json`; `.claude/agent-setup.json` before 2.0): `kit {name, version, source}`, `selection
  {mode, profile, skills, exclude, targets, hooks, roles, sessionModel}` (`mode: measure` is a baseline
  install: only the session recorder, no skills, agents, instructions or other hooks), `files {path: hash}`, `links
  {link: target}`, `skipped`, `created`, `blocks`, `settings.added`, `settings.removedByUser`,
  `agentHooks {file: {added, removed}}`.
- **Catalog** (`kit/catalog.json`): `roles`, `groups`, skills with group and summary, agents with the
  skills they require, the `step` and `when` of the AGENTS.md team table, their `tier` and, for one
  that never writes, `sandbox: read-only`, `hooks` with their
  role and summary, the `core` list, `profiles` (skill names or `@group`, or `"*"`),
  `defaultProfile`.
- **Model tiers** (`kit/models.json`, installed as `.agents/models.json`): `asOf`, `tiers {name:
  {use}}`, `families {name: tier}` (older models by family), `providers {name: {label, agents,
  source, tiers {tier: {model, alias?, effort?}}}}`, `prices {model: {input, output, cacheRead,
  cacheWrite, cacheWrite1h, long?: {above, …}}}` in USD per million tokens. A project's
  `models` section (`prices`, `tiers`, `reference`) merges over it.
- **Vendoring** (`kit/vendor.json`): `repos` (GitHub source, SPDX licence, `watch` folder),
  `skills` (name, repo, path, overrides, `why`), `excluded` (with `why`);
  `kit/vendor.lock.json`: `repos` (commits), `skills`.
- **Skill evals** stay in the kit: `evals/evals.json` (skill-creator format: `skill_name`,
  `evals[{id, prompt, expected_output, files, expectations[]}]`), `evals/trigger.json`
  (`[{query, should_trigger}]`) and, for routers and delegation, `evals/routing.json` (`scope`
  — skill names, `@group` or `agent:<name>` — an optional `fixture` folder, and
  `cases[{id, prompt, first[] | need[] | none, forbid[], when}]`), run by
  `agent-setup eval-routing`; `evals.json` is also what `agent-setup eval-outcomes` runs with
  the kit and without it.
- **Scorecards** (`scorecards/<suite>.latest.json` and `.baseline.json`): `suite`, `kit`,
  `method` (the measurement method, `EVAL_METHOD`), `model`, `date`, `runs`, `buckets
  {name: {passed, total, runs, date}}`, `metrics`; the outcome suite adds `vanilla` and
  `setup`. A run merges only into a scorecard of the same method and model, and `evals` compares
  only those — anything else is reported as not comparable.
- **Session rows** (`.agents/learnings/eval-windows.jsonl`, local): per context window, facts
  only — tokens and cache, tools and the subagents used, prompt quality (task prompts, how many
  say how done is checked, briefs written), verification after the last edit, unbacked claims,
  waste — and the `setup` it ran under (`measure` or `full`). `models` holds the main thread's
  tokens per model (`cache_create_1h` is the part of `cache_create` written for an hour; `long`, the
  calls whose prompt passed 100k); `agents_usage {type: {runs, models}}` the subagents'.
- **sdlc config**: `kit/admin/skills/sdlc-init/assets/sdlc.config.schema.json`.
