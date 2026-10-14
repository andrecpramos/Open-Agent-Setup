# Changelog

All notable changes to the kit. Versions follow semver as described in
[docs/maintaining/release.md](docs/maintaining/release.md): patch for wording and fixes, minor
for new guidance, skills or options, major for anything that needs a manual step in projects.

## Unreleased

The kit split by role, and everything a normal project would not use left it. **Breaking — a
major version.** Upgrading: run `agent-setup update <project>` and commit the result. Skills the
kit no longer ships are removed from the project while unmodified (a modified one is kept and
reported); a selection that named one drops it, with a note; the git hooks an earlier install
added leave each clone at its next Claude Code session start, or with
`node .agents/hooks/setup-clone.mjs`.

- **Model tiers: every step on the model that is worth its price.** Four tiers — frontier,
  high, medium, low — each a model and reasoning effort per provider (Claude: Fable, Opus,
  Sonnet, Haiku; OpenAI: GPT-6 Astra, GPT-6.1 Sol at high and medium effort, GPT-6 Luna;
  Gemini: 3.1 Pro, 3.8 Flash, 3.5 Flash-Lite), with every model's price, its source and the
  date it was checked, in the new `kit/models.json` (installed as `.agents/models.json`). Each
  agent names its tier in the catalog, and lint holds its file's `model` and `effort` to it.
  AGENTS.md gets a "Model tiers" table and the routing rule: size first, searching, building
  and docs go down, plans and reviews go up, escalation only on evidence.
- **Three new agents, and the existing ones moved to their tier.** `planner` (high; frontier
  for critical work) turns a brief into steps, each with its files, its check and the tier that
  should build it; `implementer` (medium) builds one step at a time and returns its check;
  `doc-writer` (low) writes the docs and changelog for a finished change. The reviewers moved
  from the session's model to high (`opus`, effort high); `gate-runner` from `sonnet` to low,
  and `docs-keeper` with it; the scout stays low. The deliver skill routes each step by size
  and tier, and its report says who did which step on which tier.
- **`prompt-intake` hands down work a cheaper model does as well.** A documentation task gets
  one line naming the `doc-writer`, and a plan of three or more steps to build one naming the
  `implementer`, when they are installed; everything else stays silent. Measured on real runs:
  without the line, a top model writes both out itself whatever the agents' descriptions and
  AGENTS.md say; with it, the docs went to the doc-writer and each plan step to the implementer.
- **Codex runs the same agents on OpenAI models.** With the `codex` target, the install writes
  each agent as a Codex custom agent (`.codex/agents/<name>.toml`) on its tier's model and
  effort, read-only where the agent never writes. A project's own file of that name wins.
- **`agent-setup usage`: what the work cost, and what the routing saved.** Cost per model and
  tier from the recorded windows, the subagents included (each run read from its own
  transcript); each subagent run priced again on the window's main model, so delegating down
  shows the most it saved (a ceiling: the subagent's cold start is priced as if the main thread
  had spent it) and escalating up its premium; the total against one reference (`--vs main`, a
  tier or a model); and the quality metrics of routed windows beside the rest.
  `--session current` or `--transcript <file>` reads one session, with Claude Code's own cost
  figure beside it as a cross-check. Inside a project, `session-eval.mjs --usage` prints the
  same; `sessionSummary` adds a cost line at session start; `evals` and `report` show it too.
- **The session recorder prices exactly.** Rows keep the 1-hour cache writes apart from the
  5-minute ones (Claude Code writes the main conversation's cache for an hour, at twice the
  input price), the calls whose prompt passed 100k tokens (Haiku 5.5's second rate card), and
  `agents_usage`: each subagent type's runs and tokens per model.
- **A project's own models and prices.** `sdlc.config.json` takes a `models` section: its own
  rates (`prices`), another model for a tier (`tiers`, written into the Codex agents on
  update), and the `reference` the usage report compares with. The eval board prices with the
  same table; its old built-in rates are gone.

- **Two roles: developer and admin.** `kit/developer/` holds what developers' agents use day to
  day — the domain skills, the delivery workflow, the review team, the guard hooks. `kit/admin/`
  holds what sets the kit up and keeps it improving — `sdlc-init`, `self-improve`,
  `enforcement-audit`, `docs-keeper` — plus the recorder and learning hooks (`session-eval`,
  `learning-signals`, `context-budget`, their role recorded in the catalog's new `hooks`
  section). A project gets the developer role always and the admin role unless
  `--roles developer`; `export --roles admin` gives an admin their own skills per user.
- **Admin skills cost developers nothing.** They set `disable-model-invocation: true`: in Claude
  Code they run only when invoked by name, and their descriptions never enter a developer's
  session. Their trigger suites are gone with the triggering; lint requires the key.
- **Fourteen design skills removed.** The design group is now `design-taste-frontend` (UI build
  direction) and `agent-browser` (real-browser verification). Gone: the image-only skills
  (`image-to-code`, `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`), the style
  layers (`high-end-visual-design`, `minimalist-ui`, `industrial-brutalist-ui`), `gpt-taste`,
  `full-output-enforcement`, `redesign-existing-projects`, `stitch-design-taste`,
  `playwright-cli`, the 74-brand `design-md-library` and the `frontend-design-workflow` router.
  Each upstream skill left out is listed under `excluded` in `kit/vendor.json` with its reason.
- **The `standard` profile is the general skills only**: `frontend`, `backend`, `api-design`,
  `security`, `architecture`. `design-system` comes with `web` and `frontend`, `agent-eval` with
  `ai-app`, either with `--skills`. A project on `standard` loses those two on update; keep them
  with `agent-setup update <project> --skills design-system,agent-eval`. A project nothing could
  be detected in is suggested `standard`, not `full`.
- **`sdlc-init` writes four documents, not twenty-one.** `project`, `rules`,
  `critical-infrastructure`, `lessons` and the ADR index. The ten SDLC phase documents, six role
  briefs, the vision and the architecture, coding-standards, security and testing documents are
  gone: area knowledge belongs in the skill overlays.
- **Prompt intake is a trigger, not a toll.** A brief is asked for only when a request is large
  or touches auth, payments, data, production or secrets. It no longer fires on vague small
  prompts, no longer holds the first edit back, and no longer coaches the developer
  (`promptCoach` is retired).
- **Code review where it pays.** `code-reviewer` runs on changes across several files or
  layers, and on risky ones — not on every change beyond a one-liner.
- **`branch-check` speaks only when the branch needs attention**: production, a detached HEAD, a
  feature branch behind the integration branch, or a config naming a missing branch. A healthy
  branch costs no tokens.
- **No admin noise in developer sessions.** The session-start metrics line is off by default
  (`workflow.sessionSummary: true` brings it back); "lessons waiting" and "retro due" moved from
  every session start to `agent-setup report`, which now honours each project's
  `workflow.retroEvery` and lists waiting lessons.
- **The git-hooks layer is gone.** `--git-hooks` rebuilt, per clone and bypassably, what branch
  protection on the git host does for everyone; it now explains that instead of running.
  `setup-clone` takes the old hooks out of each clone, and unsets `core.hooksPath` when it names
  their folder however the path is spelled (a Windows short name, a link on the way).
  `guard-git` stays — it stops the local damage the host cannot see — and on a trunk a pull
  request into it (`gh pr create --base main`) is no longer denied.
- **A shorter AGENTS.md block.** A quarter smaller: the delivery cycle in one paragraph pointing
  at `deliver`, and the learning loop present only with the admin role.
- **The hooks run in every agent that has hooks, not only Claude Code.** Codex, Cursor, GitHub
  Copilot, Antigravity and Windsurf get the kit's hooks through their own hook file
  (`.codex/hooks.json`, `.cursor/hooks.json`, `.github/hooks/agent-setup.json`, a named set in
  `.agents/hooks.json`, `.windsurf/hooks.json`). One entry point, `.agents/hooks/run-hook.mjs`,
  translates each agent's hook format for the same scripts, so every rule exists once. The git
  guard runs in all five; the post-edit check and the branch note in Codex, Cursor and Copilot;
  the brief on risky requests in Codex. The check before "done" and the session metrics stay
  Claude Code's: they read its session record. The installer finds the agents a project already
  uses (`.cursor/`, `.codex/`, `.github/copilot-instructions.md`, …) and wires each; `--targets`
  adds others. It merges into a hook file the project already has, keeps the project's own
  entries and any kit entry a person removed, and takes out exactly its own on uninstall. The
  README says which agent gets what.
- **An install anyone can follow.** In a terminal, `install` first shows — in plain words —
  what it will add to the repository and why, that nothing else changes, and how to undo it,
  then asks before writing (`--yes` skips the question; scripts and CI are never asked). The
  report after it says what was added and the next steps: open the project, `/sdlc-init`,
  commit, point the team to `.agents/WORKFLOW.md`. The file-level report is behind `--verbose`.
  A first install takes the profile that fits what the project contains and says so
  (`--profile` overrides it). Every project gets `.agents/README.md`: what the folder is, who
  edits each part, how to remove it. `agent-setup` with no command shows the two commands an
  adopter needs. The README is rewritten for programmers of any level: what the kit does in
  plain words, then a step-by-step install with a check at each step — what to have first, the
  `--targets` for your agent (a new project shows none, so without it Claude Code got neither
  the hooks nor `/sdlc-init`), how to see it worked, how to update and remove it — and a
  troubleshooting table. The maintainer reference follows, shorter, linking to the docs.
- **A new home:** https://github.com/andrecpramos/Open-Agent-Setup. Its history starts fresh,
  so `git pull` in an older clone of the kit does not follow it: clone it again, and run
  `update` on your projects from the new clone.
- **Self-contained examples.** The `sdlc-init` monorepo example config, the `self-improve`
  routing examples and the `enforcement-audit` reference use fresh, made-up scenarios.

## 2.0.0 — 2026-10-05

One kit, MIT-licensed and agent-neutral, with the SDLC layer, the delivery workflow and the
measurement loop built in. **Upgrading from 1.x:** run `agent-setup update <project>` from this
version and commit the result — it moves the install to its new home by itself (below). Each
teammate's clone repairs its own links: Claude Code's session start does it, or run
`node .agents/hooks/setup-clone.mjs`.

- **An agent-neutral home: `.agents/`.** Skills, hooks, licences, the manifest, the developers'
  guide, `sdlc.config.json`, the learnings and the overlays now live in `.agents/`, the folder
  Agent Skills readers already use. Nothing vendor-specific is written unless the project uses
  that agent: Claude Code is targeted when the project has `.claude/` or a `CLAUDE.md` (or with
  `--targets agents,claude`), and then gets only what it cannot read from `.agents/` —
  `.claude/settings.json` (hooks run from `.agents/hooks/`), the subagents in `.claude/agents/`,
  and per-clone links `.claude/skills/<name>` → `.agents/skills/<name>` (the links ran the other
  way in 1.x). Without that target the agents install as procedures in `.agents/agents/` and no
  runtime hook is installed; `status` says the Claude Code hooks are not targeted.
- **No more kit-made `CLAUDE.md`.** Claude Code reads `AGENTS.md` by itself when there is no
  `CLAUDE.md`, so the Claude Code notes moved into AGENTS.md's managed block (a "Claude Code"
  section, present only with that target). A project's own `CLAUDE.md` gets a block importing
  AGENTS.md; one that held nothing but the kit's block is removed on update.
- **Fresh clones link themselves.** Claude Code's first session-start handler runs
  `setup-clone.mjs --hook`: in a clone without the skill links it creates them and says to run
  `/reload-skills`; otherwise it stays silent.
- **The 1.x migration is automatic and keeps your work.** `update` unlinks the old
  `.agents/skills` links, moves `.claude/sdlc.config.json`, `learnings/`, `overlays/`, `docs/`,
  `decisions/` and `handoffs/` to `.agents/` (never over a file already there — that is
  reported for a merge by hand), removes the old kit files from `.claude/` while unmodified
  (modified ones stay and are reported), rewires the hooks, and keeps every hook handler you had
  removed. The hooks and the CLI still read a not-yet-migrated install.
- **Old eval runs never skew new ones.** Every scorecard records its measurement `method` and
  model. A run merges only into a scorecard of the same method and model — otherwise it starts
  fresh and says why — and `evals` gates only like against like: a baseline of another method
  or model is reported as "not comparable", never as a regression, and `report` lists the suite
  as ungated. The scorecards measured through the old plugin are gone; the first full pass on
  this method sets the new baselines.
- **MIT licence.** `LICENSE` at the root; an install puts the kit's notice in
  `.agents/licenses/agent-setup.txt`, and `export` puts it into every own skill folder, beside
  the upstream licences of the vendored ones.
- **The SDLC layer is part of the kit.** The contract, the hooks, `sdlc-init`,
  `enforcement-audit` and the config schema are maintained here, with no outside source to
  track: `vendor record`, the fingerprints in `vendor.lock.json` and the in-place upgrade of
  hooks from an older standalone install are gone (such a hook now gets a `.kit-new` beside it,
  like any other local file). Why each rule exists: `docs/SDLC.md`.
- **Nothing agent-specific in the repository.** The Claude Code plugin folders are gone —
  `agent-setup export` + `npx skills add` installs the skills for any agent, Claude Code
  included. The maintainer procedures moved from slash-command skills to
  `docs/maintaining/harvest.md` and `release.md`, which any agent or person can follow; the
  repository has no `CLAUDE.md` (Claude Code reads `AGENTS.md`); maintainers' agent folders are
  gitignored.
  The eval runners copy the kit's skills and agents into each scratch project (without their
  evals) instead of loading a plugin; `eval-outcomes --setup plugin` is now `--setup skills`.
- **`web-design-guidelines` removed.** Its upstream declares no licence, so it cannot be
  redistributed. The design router audits with `agent-browser a11y` and a code review against
  the `frontend` skill's accessibility rules; the design group has 16 skills.
- **Tests run on Node 18 and 20.** `scripts/test.mjs` lists the test files, because the glob
  `node --test` expands arrived only in Node 21.
- **`check-gates` on Windows short paths.** When a path arrived in 8.3 form
  (`C:\Users\LONGNA~1\…`) and git reported the long one, every edited file looked as if it
  were outside the repository and no post-edit check ran. Both sides are resolved first.

- **One delivery cycle in every project.** AGENTS.md gains "How work flows here" — brief,
  plan, build, verify, review, report — and a "Who does what" table of the installed agents
  with when to delegate to each, generated from the catalog (`step`, `when`). The new core
  skill `deliver` holds the procedure: sizing (XS to L), the brief format, plans for large or
  risky work before editing, small verified steps, parallel reviews, the report against the
  acceptance line; with references for briefs and delegation, evals and a delegation suite.
- **A code reviewer on the team.** `code-reviewer` reviews a diff against its brief:
  correctness with the input that breaks it, tests that prove the change, scope, leftovers.
  Installed in every profile.
- **Prompt intake.** The `prompt-intake` hook asks the agent to restate a vague, risky or large
  task prompt as a brief before its first edit — and holds that first edit back once until the
  brief is written (measured: the note alone was ignored) — names the reviewer for auth, payments, data,
  production and secrets, and gives the developer one tip per session on what the prompt left
  out. Silent for questions, replies, commands, short tasks and prompts that already say what
  they need. The rubric (`_prompt.mjs`, English and Portuguese) is shared with the session rows
  and the eval-board. `workflow.promptIntake` and `workflow.promptCoach` turn it off.
- **A page for the developers.** `.agents/WORKFLOW.md`, installed in every project: how to ask,
  what the brief and the hooks mean, the commands, how feedback improves the setup.
- **Measure first.** `install --setup measure` (or `--measure-only`) installs only the session
  recorder — no skills, agents, instructions or other hooks — as a baseline of how the team
  works without the kit; `update --setup full` turns the kit on. Rows record the setup they ran
  under, and `agent-setup evals` shows "Baseline vs kit" side by side.
- **The kit against vanilla.** `agent-setup eval-outcomes` runs each `evals.json` case in two
  fresh scratch projects — the kit installed, and nothing — and a blind grader checks everything
  the agent wrote and did, in order, its final reply and the files it changed against the
  expectations. The scorecard gates the kit arm and keeps vanilla beside it; `evals` prints the
  lift per skill.
- **Delegation evals.** Routing suites can name subagents (`agent:<name>`) in their scope,
  require an activation at any point (`need`, with `a|b` alternatives), and run in a fixture
  project with an uncommitted diff. `deliver` ships the first such suite.
- **The weekly cycle in one command.** `agent-setup report` gathers every project's health,
  learnings and windows, the scorecards and the metrics, and ranks the next actions with their
  commands; `--harvest` collects proposals first, `--md` writes it to share.
- **A retro when one is due.** `learning-signals` tells the agent at session start when
  `workflow.retroEvery` (default 20) windows have gone by since the last retro.
- **Richer session rows.** Each row records prompt quality (task prompts, mean score, how many
  say how done is checked or bound the scope, briefs written) and the subagents used. New
  metric: task prompts that say how done is checked. Unbacked claims are now a share of
  windows, so periods of different length compare.
- **Nothing machine-specific in the repository.** The project registry moved to
  `~/.agent-setup/projects.json` (a registry in a checkout's `.state/` is read until the first
  write), so moving or re-cloning the kit no longer orphans projects. No file in the repository
  names a folder on anyone's machine. The README installs from a clone or `npx github:…`.
- **No question before every session's first edit.** `branch-check` used to tell the agent to
  ask which branch to work on and wait; measured against vanilla, that made a one-word fix cost
  a round trip. The agent now decides — small changes on the integration branch, larger ones on
  a new feature branch — and names the branch in its brief. `workflow.askBranch: true` restores
  the question.
- **Reminders for people go to people.** "Run /sdlc-init" is now shown to the developer once at
  startup instead of being handed to the agent, which used to repeat it in the report of a
  one-line fix. The agent is still told the contract is unverified.
- **A refused command is not a failed check.** A test command the permission system or a hook
  refused never ran; the stop-check no longer reports it as a failing check, and the rows no
  longer count it as one.
- **Smaller fixes.** `new-skill` adds one catalog line instead of re-serialising the file; the
  install report lists every hook it wires and `status` checks all of them; `package.json`
  lists the files a package needs; `eval-outcomes` runs a skill's cases inside its
  `evals/fixture/` when it has one, prints the grader's reason for every missed expectation
  (`--verbose` adds the reply and the tools used), and lets both arms run the tests through
  Bash or PowerShell.
- **The playbook, rewritten** for the maintainer: piloting a repository with a baseline, the
  weekly cycle, the numbers and their targets (now in code beside the metrics), deciding what to
  change, outcome evals, an experiment log, and rolling out to a team.

- **New mistakes that matter, each with a regression case.** `frontend`: unscoped component
  stylesheets, imperative classes on a React-managed `className`, chaining on `media.play()`.
  `design-system`: primitives imported after components. `frontend-design-workflow`:
  Playwright's WebKit on Windows is not Safari, and a new §3 row (a brand's own nav and CTAs
  outrank a style layer's signature components); its first `evals.json`. `gates`: the same
  command in a different environment (Node major, install scope). `backend`: a deploy path is
  verified by a no-cache build and the exact health check, against `127.0.0.1`. The CLAUDE.md
  block now says to spawn subagents from the repository root, because their project memory
  lands under the directory they start in. No description changed, so the routing and trigger
  baselines stand.
- **Harvested proposals stay out of git.** `inbox/` is gitignored except its README: proposals
  and triage records name the projects they came from. The harvest procedure now requires kit
  changes to be stated generically: no project names, paths or identifiers, and eval cases written as
  fresh scenarios rather than copied from the proposal.
- **`status` reports what the version string misses.** "(current)" now means `update` would
  change nothing. An install from an older build of the same version shows `same version, but
  update would change N file(s)`. `status` also warns when a project was installed from
  another copy of the kit, or is missing from this kit's registry (so `harvest`, `update --all`
  and `evals` skip it), and counts the universal lessons still waiting in its inbox; `harvest`
  lists those per project too. `status --all` and `evals` say when the registry is empty.
- **The eval loop, end to end.** `docs/PLAYBOOK.md` says what to do when — starting a
  project, every session, the numbers and their starting targets, the retro, improving and
  releasing the kit.
- **`agent-setup evals` — the summary rows.** The kit's eval scorecards against their
  baselines, then the session metrics across every registered project, the last 20 windows
  against the 20 before: code checked after its last edit, last check passed, claims the
  transcript does not back, corrections per prompt, failed tool calls, wasted tool output,
  heavy output re-read, cache hit rate, and cost per window in input-token equivalents.
  `--check` is the CI gate, `--promote` accepts reviewed scorecards as the new baselines (the
  file moves, so there is one copy, and the next run starts from the baseline's buckets),
  `--project` shows one project, and each suite lists its weakest buckets — where to work next.
  Inside a project, without the kit: `node .agents/hooks/session-eval.mjs --summary`.
- **Eval runs respect the plan's limits.** `eval-routing` stops at the first usage or rate limit
  instead of launching the rest of its queue, and `--max-runs n` caps a pass; cases left over
  are listed as not run and their buckets keep their last scores.
- **`frontend` and `security` descriptions rewritten** after the baseline loaded them for 5 and
  3 of 10 positive queries. `security` no longer points at Claude Code's built-in review
  command, which took its prompts. Measured: `frontend` 5→8 of 10, `security` 3→5 of 10 (still the weakest bucket; agents often answer
  without loading it).
- **Sharper `architecture` and `backend` descriptions.** The first trigger baseline loaded
  `architecture` for 5 of its 10 queries and `backend` for 4 of 10. Both now name the
  phrasings that missed: reviewing an RFC, container diagrams, import-boundary lint rules, an
  ORM leaking into the domain, "is X worth it for our team"; Redis, Celery-style workers, a job
  that ran twice, correlation ids, test databases that differ from production.
- **The session-start line.** `session-eval` shows you one line of those metrics when a session
  starts — a message to you only, never in the model's context. Off with
  `workflow.sessionSummary: false`.
- **Trigger suites run.** `eval-routing --suite trigger|all` runs every skill's
  `evals/trigger.json` in a real agent (193 cases); `--runs n` repeats cases and marks flaky
  ones; `--save` merges the buckets that ran into `scorecards/<suite>.latest.json`. The default
  agent now runs with project settings only (the user's own plugins stay out of the
  measurement) and up to 6 turns, and a positive trigger case stops as soon as its skill loads.
  A run that errored — no output, a usage or rate limit — is reported and never scored.
- **Noise-aware regression gate.** `compare-scorecards.mjs` flags a bucket only when its drop
  exceeds both the tolerance and the sampling noise (z × the standard error of the
  difference); with 10–20 cases a one-case flip no longer fails CI. `--z 0` restores the
  plain tolerance gate. The `agent-eval` skill explains it, with a new eval case.
- **`stop-check` hook.** When the agent is about to finish with code or config changed after
  the last passing check — or the last check failed — it blocks the stop once and asks for the
  check (the gates, or the project's test and lint commands). Once per edit, so it never loops;
  prose, scratch files and agent memory never trigger it; the gate-runner agent and a
  project's own gate commands count as checks. Off with `workflow.verifyBeforeStop: false`.
- **`context-budget` hook and the `scout` agent.** Past 150k tokens in a context window (and at
  each further 150k), one note asks the agent to delegate searches, read narrowly and hand off
  at a break (`workflow.contextWarnTokens`). The new read-only `scout` subagent explores in its
  own context and returns a `file:line` map instead of file contents; it installs with every
  profile. The project AGENTS.md block gained a "Working economically" section.
- **Corrections are measured.** The correction detector moved from `learning-signals` into the
  shared parser, now ignores context an editor prepends to a prompt, and `session-eval` counts
  corrections per window.
- **The retro starts from the numbers.** `self-improve` reads the summary rows, finds the
  windows behind a metric that got worse, and ties each routed lesson to the metric it should
  move (new eval case). The harvest procedure reads `agent-setup evals` across projects; the
  release runs the suites and `evals --check`.
- **CI** (`.github/workflows/check.yml`): `npm run check` and `evals --check` on Linux and
  Windows, Node 18 and 22.

- **`session-eval` hook: one row of facts per context window.** At `PreCompact` and
  `SessionEnd` it reads the transcript and appends a row to
  `.agents/learnings/eval-windows.jsonl` (gitignored, capped at 500, one row per session and
  window). A row holds tokens and cache hit rate per model, token waste (files re-read with no
  edit between, output of failed calls) and heavy tool results with what the later calls paid
  to re-read them, whether a check ran after the last edit and passed, and whether the final
  message claims a verification the transcript doesn't back. No model tokens, nothing added to
  the agent's context, no prompt or command text stored.
- **One transcript parser** (`kit/hooks/_transcript.mjs`), shared by the hook and
  `eval-board`. Fixes in it: usage is counted once per API call — Claude Code writes one
  response as several lines with the same usage, and the board counted each line, so its
  token and cost figures ran about 4× high on real sessions; peer messages, task
  notifications, meta lines and the compaction summary no longer count as prompts; a failed
  edit no longer counts as a changed file.

- **`agent-setup eval-board`** — a local eval UI for agent work: paste the prompt, the run
  numbers (tokens, cost, turns, tool calls, duration, files changed) and the output with its
  expectations, and the board scores each panel, rewrites a weak prompt into
  goal/context/constraints/acceptance/scope form, and suggests the cheapest workflow fix
  first. Offline heuristics, no API key; `eval-board --json` evaluates without a browser and
  the scorecard downloads in the `agent-eval` scorecard shape.
- **`agent-setup eval-board --project <dir>` (live session feed).** The board reads the
  project's installed skills and tails the live Claude Code session: per-prompt scores,
  real tokens / cost / model / durations (the transcript's `cost-state` when present,
  labelled estimates otherwise), every tool call with failures, files changed, and skill
  routing as heuristic prediction versus transcript activation. The page polls every 2s
  and follows new context windows via the pointer the `learning-signals` hook leaves in
  `.agents/learnings/live-session.json`; `--session <id>` pins one session.
- **Eval loop: history, trends, promote-to-case.** Every live poll upserts one row per
  session into `.agents/learnings/eval-history.jsonl` (capped at 200, corrupt rows
  skipped), and the board shows averages plus per-skill routing accuracy (predicted vs
  actually loaded, across sessions). The page leads with the single next fix, and any
  missed expectation, tool-loop or routing mismatch can be promoted to a permanent case:
  project lessons land in `.agents/learnings/eval-cases.jsonl`, skill lessons become
  `outbox/` proposals with evidence and a regression case for `agent-setup harvest`.

- **TypeScript CLI.** The CLI is strict TypeScript without changing its runtime:
  `src/**/*.mts` is the source of truth, `npm run build` typechecks (tsc) and emits the
  committed `lib/*.mjs`, `bin/*.mjs` and `tests/*.test.mjs`, and `npm run typecheck` joins
  `npm run check`. `typescript` + `@types/node` are dev-only; the runtime stays
  zero-dependency Node 18+, and `kit/hooks/` stays plain `.mjs` (it runs in projects, where
  no build happens).

- **Breaking — one kit, no packs.** The 17 `frontend-kit` skills are now the kit's `design`
  group in `kit/skills/`. `--packs frontend-kit` is replaced by `--skills @design` or the `web`
  and `frontend` profiles (a project installed with the pack keeps its design skills on
  `update`). `agent-setup install … --packs` and `new-skill --pack` explain the replacement
  instead of running.
- **Breaking — default profile `standard`** (domain + core skills). The design group is
  opt-in: its descriptions load into every session and its brand library adds 2.3 MB to a
  repository. `--profile full` keeps the old everything-installed behaviour.
- **Breaking — one copy of every skill in projects.** 1.0 kept a second copy of every skill;
  there is now one, in `.agents/skills/`, and Claude Code reaches it through per-clone links
  (junctions on Windows, no admin rights), git-ignored. `update` removes the old copies. The
  per-clone script, `.agents/hooks/setup-clone.mjs`, replaces `install-git-hooks.mjs` for the
  git hooks.
- **Vendoring in the CLI.** `agent-setup vendor sync [--locked] [--source repo=dir]`,
  `vendor status` and `import <github-url>` replace the pack's `sync-vendor.mjs` and the
  `upstream` command. `kit/vendor.json` and `kit/vendor.lock.json`
  record every third-party skill, its overrides with a `why`, and the exact commits.
- **Licences once per source.** `kit/licenses/<source>.txt` replaces twelve identical per-skill
  copies; projects get `.agents/licenses/` with the licences their skills need.
- **`agent-setup export <dir>`** writes self-contained copies for the routes that copy one skill
  folder at a time (`npx skills add` for any agent, per project or per user; claude.ai
  upload): each vendored folder carries its LICENSE, references point at it, and Claude-only
  frontmatter keys are removed. Pointing `npx skills add` at `kit/` would copy vendored skills
  without their licences, so the README now routes those installs through an export.
- **`sdlc-init` and `enforcement-audit`** state in `compatibility` that they run forked only in
  Claude Code and inline elsewhere, and why their export drops the forking keys.
- **Routing evals in the CLI.** `agent-setup eval-routing` runs `evals/routing.json` suites
  (now beside the skill they test, with a `scope`) in Claude Code or any agent via `--cmd`.
- **Lint as the tidiness gate.** One kit, own skills strict and vendored skills held to the
  Agent Skills spec; routing suites, vendoring, licences and the catalog cross-checked; and
  repository-wide: the tree must match the Layout tables in `AGENTS.md`, no two files may have
  the same content, and no file may carry control characters, U+FFFD, a BOM or (in code)
  invisible characters.
- **AGENTS.md skills table** and the install report list skills in catalog order (frontend,
  backend, api-design, security, …) instead of alphabetically.
- **Fixed:** six role-brief templates in `sdlc-init` had their **Skills** lines corrupted by
  shell quoting (backticks stripped, three letters turned into control characters); ten source
  files carried invisible literal BOM characters instead of `\uFEFF` escapes.

## 1.0.0 — 2026-09-26

First internal version, never published: the installer (`install`, `update`, `status`,
`uninstall`, `harvest`, `lint`, `list`, `new-skill`, `import`), non-destructive by
construction (hashed kit-owned files, managed blocks, recorded settings merges, `.kit-new` on
conflict); thirteen skills (seven domain, six workflow) with references and evals; four
subagents; the runtime hooks (`branch-check`, `guard-git`, `check-gates`,
`learning-signals`) and the git guard; `AGENTS.md` as the instructions every agent shares.
