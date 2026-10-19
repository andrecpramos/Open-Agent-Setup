# Agent_Setup — instructions for agents working on the kit

This repository **is** the product: a portable, self-improving agent setup that
`agent-setup install` injects into other projects. Changes here reach every project on the
next `update`, so the bar is higher than in an ordinary repo. Humans start at `README.md`.

## Layout

One place per theme. `agent-setup lint` checks the tree against these two tables in both
directions: an entry that is not listed is an error, and so is a listed path that does not
exist. A new place gets its row here in the same change — or it belongs in an existing one.

| Path | What | Rule |
|---|---|---|
| `kit/` | the payload installed into projects, by role | see the next table |
| `src/` | the CLI's TypeScript source; `bin/` + `lib/` build from it | strict TS; `npm run build` after every edit; never hand-edit build output |
| `bin/` | the CLI entry point, `agent-setup` | Node 18+, **zero runtime dependencies** — build output of `src/bin/`, never hand-edit |
| `lib/` | the CLI's modules: install/update (`sync`), other agents' hook files (`agent-hooks`), the model tiers and other tools' agent files (`models`), vendoring (`vendor`), portable copies (`export`), routing, trigger and delegation evals (`routing`), the kit against vanilla (`outcomes`), the eval summary (`evals`), cost and routing savings (`usage`), the weekly cycle (`report`), `lint` | same as `bin/` (build output of `src/lib/`) |
| `scorecards/` | the kit's eval results: `<suite>.latest.json` from `eval-routing --save` and `eval-outcomes --save`, `<suite>.baseline.json` accepted with `evals --promote`; each stamped with the measurement method and model | written by the CLI, never by hand; CI fails when latest regresses against a baseline of the same method and model; bump `EVAL_METHOD` with any change to how runs are measured |
| `.github/` | CI: `npm run check` and `evals --check` on every pull request and every push to `main` (protected: changes land through a pull request with the four checks green) | |
| `scripts/` | dev scripts: the TypeScript build and the test runner | plain Node, zero runtime dependencies |
| `tests/` | `node:test` suites; hook and CLI tests run real git repos | |
| `docs/` | PLAYBOOK, ARCHITECTURE, AUTHORING, SELF-IMPROVEMENT, SDLC; `maintaining/` holds the maintainer procedures (harvest, release) | keep true to the code |
| `inbox/` | kit-improvement proposals harvested from projects | triage with `docs/maintaining/harvest.md`; gitignored except its README |
| `README.md`, `CHANGELOG.md`, `LICENSE` | for humans; the kit is MIT | a CHANGELOG line for every user-visible change |
| `AGENTS.md` | for agents: this file — every agent reads it, Claude Code included (it reads AGENTS.md when there is no CLAUDE.md) | say everything here; no CLAUDE.md, which would hide this file from Claude Code |
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `.gitattributes` | the one version, scripts and strict TS config; reproducible dev installs; machine-local state and maintainers' agent folders kept out of git; LF line endings in every checkout | |

| Path in `kit/` | What | Rule |
|---|---|---|
| `kit/developer/` | the developer role: `skills/` (domain, workflow and design skills, own and vendored side by side), `agents/` (the review team), `licenses/` (one licence per upstream source of the vendored skills, which all serve this role) | own skills: `docs/AUTHORING.md`; vendored skills and `licenses/`: written only by `vendor sync` |
| `kit/admin/` | the admin role: `skills/` (`sdlc-init`, `self-improve`, `enforcement-audit`) and `agents/` (`docs-keeper`) — setting the kit up in a project, auditing it, routing what it learns | admin skills set `disable-model-invocation: true`: run by name, they cost developer sessions nothing |
| `kit/catalog.json` | the roles; each skill's group (`domain`, `core`, `design`, `admin`); the agents, when to delegate to each and the model tier each runs on; each hook's role; the install profiles | every skill, agent and hook is listed |
| `kit/models.json` | the model tiers (frontier, high, medium, low): what each is for, the model and reasoning effort each provider runs it on, and every model's price with its source and date; the orchestrator — the session itself, its tier and the name that resolves to it per account (Claude Code: `best`); installed as `.agents/models.json` | the one place for models and prices — agents, the AGENTS.md tier table, Claude Code's starting model, other tools' agent files and the usage report all read it; a project overrides it in its sdlc config, never by editing the copy; check the prices when `asOf` gets old |
| `kit/vendor.json` | the vendored skills: where each comes from, each local override and its `why`; the upstream skills left out, and why | edit this, then `vendor sync` |
| `kit/vendor.lock.json` | the exact upstream commits | written only by `vendor sync` |
| `kit/hooks/` | the runtime hooks of both roles (one folder: they share `_config.mjs` and install as one), `run-hook` (the same hooks in every other agent, translating its hook format — the agents' hook files are written by `lib/agent-hooks`), and `setup-clone` (per-clone Claude Code skill links); `_transcript.mjs` (the transcript parser), `_prompt.mjs` (the prompt rubric) and `_usage.mjs` (prices, cost math and the usage report) are imported by the CLI too, typed by their `.d.mts` (never installed) | fail open and log; change a `.d.mts` with its module; a hook speaks only when it has something to act on |
| `kit/templates/` | the project AGENTS.md block and its Claude Code section, the blocks for a project's own CLAUDE.md and for GEMINI.md, the developers' guide (installed as `.agents/WORKFLOW.md`), the README that says what `.agents/` is (installed as `.agents/README.md`), the learnings and overlays READMEs, the `.gitignore` block | the guide is for people, AGENTS.md for agents: say a thing once, in the right one |
| `kit/settings.fragment.json` | hooks and permissions merged into a project's `.claude/settings.json` | |

## Where the skills come from

- **Own skills** are written here, to `docs/AUTHORING.md`: each reads its project overlay, says
  when to use it, names the mistakes that matter, and has evals.
  `node bin/agent-setup.mjs new-skill <name> --group <group>` scaffolds one that passes lint.
  The SDLC layer — the hooks, `sdlc-init`, `enforcement-audit` and the config schema — is own
  code too; why each of its rules exists is in `docs/SDLC.md`.
- **Vendored skills** are third-party skills listed in `kit/vendor.json`, rebuilt into
  `kit/developer/skills/` by `agent-setup vendor sync`. Never hand-edit a vendored folder: the
  next sync overwrites it. Frontmatter changes go in `vendor.json` as overrides, each with a
  `why`; an upstream skill left out goes under `excluded`, with its `why`. Add a skill with
  `agent-setup import <github-url>`, and only from a source that declares a licence allowing
  redistribution — and only if a normal project would use it (rule 7).
- To read a kit skill here (none is installed in this repository), open
  `kit/developer/skills/<name>/SKILL.md` or `kit/admin/skills/<name>/SKILL.md`.

## Commands

| Task | Command |
|---|---|
| The gate: skills, catalog, vendoring, licences, layout, duplicates, corrupted text | `node bin/agent-setup.mjs lint` |
| All tests | `npm test` (≈ 30 s; creates temp git repos) |
| One test file | `node --test tests/hooks.test.mjs` |
| One test by name | `node --test --test-name-pattern="shared tree" tests/hooks.test.mjs` |
| Lint + tests | `npm run check` (build, lint, strict typecheck, tests) |
| Build the CLI from `src/` | `npm run build` (typecheck + emit to `lib/`, `bin/`) |
| Typecheck the CLI only | `npm run typecheck` |
| Try an install | `node bin/agent-setup.mjs install <temp-project> --dry-run` (`--roles developer` for the developer role alone) |
| Rebuild vendored skills exactly as locked | `node bin/agent-setup.mjs vendor sync --locked` |
| Take upstream changes into vendored skills | `node bin/agent-setup.mjs vendor sync`, then review the diff |
| What changed upstream | `node bin/agent-setup.mjs vendor status` |
| Which skill or agent a real agent picks for a prompt | `node bin/agent-setup.mjs eval-routing` (Claude Code; `--cmd` and `--assume` for other agents) |
| Is a skill better than vanilla | `node bin/agent-setup.mjs eval-outcomes --skill <s> --save` (each evals.json case with the kit installed and without it, graded blind; cases × 2 agent runs) |
| Every routing and trigger suite, saved as scorecards | `node bin/agent-setup.mjs eval-routing --suite all --save` (≈ 200 agent runs of real usage; `--skill <s>` for one, `--max-runs n` to cap; a usage limit stops it) |
| The summary rows: scorecards vs baseline, session metrics, baseline vs kit | `node bin/agent-setup.mjs evals` (`--check` is the CI gate, `--promote` accepts a baseline) |
| The weekly cycle: next actions, ranked | `node bin/agent-setup.mjs report` (`--harvest` collects proposals first; `--md <file>` to share, outside this repo) |
| A baseline before the kit, in a project | `node bin/agent-setup.mjs install <project> --setup measure`, later `update <project> --setup full` |
| Self-contained copies for `npx skills add` or claude.ai upload | `node bin/agent-setup.mjs export <dir-outside-the-kit>` |
| The official Agent Skills validator | `PYTHONUTF8=1 skills-ref validate kit/<role>/skills/<name>` (`pip install skills-ref`) |

Tests that call the CLI set `AGENT_SETUP_STATE_DIR` and `AGENT_SETUP_INBOX_DIR` so they never
touch the real registry (`~/.agent-setup/`) or inbox — do the same in any new test. Eval
runners are tested with stand-in agents (`--cmd`, `--grader-cmd`): no test spends a real agent
run.

## Rules

1. **Own skills meet `docs/AUTHORING.md`; vendored skills meet the Agent Skills spec.** Lint
   enforces the mechanical parts of both.
2. **Behaviour changes come with tests.** A hook change without a case in
   `tests/hooks.test.mjs` is not done; a skill change comes with an eval case; a routing
   change (a description, the design router, an agent's description) is checked with
   `eval-routing` — a harmless-looking description edit can steal prompts from another skill;
   a change to what a skill teaches is checked with `eval-outcomes` before the release that
   ships it — its lift over vanilla must not drop.
3. **Hooks fail open and log.** Never exit non-zero from a runtime hook, never throw; write
   swallowed errors with `logError`; keep the entry point at the bottom of the file (a
   top-level-await TDZ bug hid twice behind fail-open). A hook is silent until it has something
   the agent or the person must act on: a note on every prompt or every session start is a toll
   that teaches everyone to skim the channel.
4. **Nothing destructive in projects.** The installer never overwrites a project-owned or
   locally modified file; new behaviour must keep `update`/`uninstall` exact (see the ownership
   model in `docs/ARCHITECTURE.md`). Links are removed with unlink, never a recursive delete —
   a recursive delete through a Windows junction reaches the real files.
5. **Portable first.** Portable frontmatter only (`name`, `description`, `license`,
   `compatibility`, `metadata`, `allowed-tools`) unless an agent-specific key degrades
   gracefully. In skill instructions, name no single vendor's tools ("fetch the URL", "run the
   command"); link skills by relative path (`../<skill>/SKILL.md`) as well as by name; declare
   needed CLIs, network access or image generation in `compatibility`. Nothing in this
   repository assumes the maintainer's agent: their agent folders are gitignored.
6. **One copy of everything.** Lint fails on two files with the same content. A skill in two
   places (or one name in both roles), or a second folder for a theme that already has one, is a
   defect — merge it. In
   projects, everything the kit installs exists once, in `.agents/`; Claude Code gets per-clone
   links, and only the files it cannot read from there (settings, subagents) go to `.claude/`. Copies that must be
   self-contained (a skill folder installed on its own needs its LICENSE) are build output of
   `agent-setup export`, written outside the repository — never committed here.
7. **Two roles, kept apart.** What developers' agents use day to day lives in `kit/developer/`;
   what sets the kit up, audits it and routes its lessons lives in `kit/admin/`, and its skills
   run only when invoked by name. A new skill, agent or hook names its role; anything a normal
   project would not use in its delivery lifecycle does not enter the kit.
8. **Write files with the editor tools or a quoted bash heredoc — never through PowerShell
   strings.** PowerShell turns `` `a `` into a BEL character, drops other backticks and expands
   `$names`. Lint catches the control characters; it cannot catch a backtick silently lost.
9. **One version.** `package.json` holds the kit's version; every user-visible change gets a
   line in `CHANGELOG.md` under Unreleased.
10. **TypeScript source of truth.** `src/**/*.mts` (strict) builds to the committed
    `lib/*.mjs`, `bin/*.mjs` and `tests/*.test.mjs` via `npm run build`; never hand-edit build
    output — edit `src/` and rebuild. `typescript` + `@types/node` are dev-only; the runtime
    stays zero-dependency Node 18+. `kit/hooks/` stays plain `.mjs` (it runs in projects,
    where no build happens).
11. **Generic only.** This repository is public and serves every project. A lesson from a
    project enters as the general rule: no project names, paths, file or class names, people
    or incidents in skills, evals, docs, tests or the changelog. Eval cases are fresh
    scenarios, not the project's story. No machine-local path either: nothing here refers to a
    folder on anyone's computer.

## Workflows

- Improving the kit from project lessons: follow `docs/maintaining/harvest.md`.
- Shipping a version: follow `docs/maintaining/release.md`.
- New skill: `node bin/agent-setup.mjs new-skill <name> --group domain|core|design|admin` (`admin`
  scaffolds it in `kit/admin/`); a third-party one: `node bin/agent-setup.mjs import <github-url>`.
