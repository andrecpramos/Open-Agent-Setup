# Playbook

How to run projects with this kit, and how the kit gets better from them. The other documents
explain how things work; this one says what to do, when, and which number tells you it worked.

## Who does what

| Role | Works in | Their part |
|---|---|---|
| **Developers** | their projects | ask well, read the brief, correct the agent plainly, run a retro now and then. Everything they need is one page: `.agents/WORKFLOW.md`, installed in every project ([template](../kit/templates/workflow-guide.md)). |
| **The agent** | the projects | follows the cycle in the project's AGENTS.md — brief, plan, build, verify, review, report — with the hooks holding it to it. |
| **The maintainer** | this repository | pilots, the weekly cycle, kit changes, releases. This playbook is theirs. |

## The loop

```
  every session (automatic)                    every week (≈ 45 min)                   in the kit
  ─────────────────────────                    ─────────────────────                   ───────────────────────────────
  prompt-intake → a brief before work          agent-setup report --harvest            harvest: skill edit + eval case
  hooks guard, check and measure      ──▶      retros in the projects it names ──▶     eval-routing / eval-outcomes --save
  one row of facts per context window          (/self-improve retro)                   evals --check, then release
                                                                                                  │
  every project ◀──────────────────────────── agent-setup update --all ◀─────────────────────────┘
```

Nothing in the loop costs model tokens except the work itself and the eval suites you choose
to run. Measuring happens in hooks, from the transcript.

## 1 · Pilot a repository — the honest comparison

The only fair answer to "is this better than working without it?" comes from the same team on
the same repository, before and after. So a pilot measures first.

| Phase | How long | Do | Done when |
|---|---|---|---|
| **0 · Baseline** | 1–2 weeks | `agent-setup install <project> --setup measure`. It installs only the session recorder: no skills, agents, instructions or other hooks, nothing the agent sees. The team works as usual. | 20+ context windows recorded (`agent-setup report` says when) |
| **1 · Turn on** | a day | `agent-setup update <project> --setup full`, restart Claude Code, run `/sdlc-init` (gates verified against CI). Share `.agents/WORKFLOW.md`; give the 15-minute demo (§8). Claude Code's session start links the skills in each clone by itself. | `agent-setup status <project>` clean; `sdlc.config.json` not provisional; one gate made to fail on purpose |
| **2 · Run** | 2–3 weeks | normal work; the weekly cycle (§4) includes this project | 20+ windows with the kit |
| **3 · Compare** | an hour | `agent-setup evals --project <project>`: the "Baseline vs kit" table | the decision below is written in the experiment log (§7) |

Reading the comparison:

- **Different work in each period** is the main confounder. Read the windows behind any large
  difference before believing it; compare metrics that do not depend on the task (checked
  after the last edit, unbacked claims, corrections per prompt, cache hits) before cost.
- **Under 20 windows on a side**, the table says so: a hint, not a result.
- **Decide**: keep (most metrics better or equal, none clearly worse) · adjust (one metric worse
  — find its lever in §3, retro, re-measure) · stop and report (the kit makes the team slower or
  noisier — that is a finding the kit needs).

Choose pilots of different shapes (a web app, a backend service, a library), active enough to
produce several sessions a week, with a team willing to say what annoys them.

## 2 · Every session — what happens on its own

| Hook | When | What happens | Cost to the model |
|---|---|---|---|
Every hook is silent until something needs doing. The admin role's hooks (marked) are left out
by `--roles developer`.

| Hook | When | What happens | Cost to the model |
|---|---|---|---|
| `branch-check` | session start | only when the branch needs attention (production, detached, behind the integration branch, a wrong config): the situation and the contract | a few lines, only then |
| `prompt-intake` | each prompt | a large or risky task (auth, payments, data, production, secrets) → the agent writes a brief before its first edit | ~100 tokens, only then |
| `learning-signals` (admin) | each prompt | a correction or "from now on" prompts the agent to note the lesson in the inbox | a few lines, only then |
| `context-budget` (admin) | each prompt | past 150k tokens (and each further 150k), asks the agent to delegate, read narrowly and hand off | ~90 tokens, once per band |
| `guard-git` | before a shell command | denies production writes, force-pushes, hook bypasses; names the alternative | only when it denies |
| `check-gates` | after an edit | runs the fast check that edit could break | only on failure |
| `stop-check` | end of a turn | code changed after the last passing check → asks once for the check | one turn at most, once per edit |
| `session-eval` | compaction, session end | records one row of facts for the window | none |

## 3 · The numbers

In a project: `node .agents/hooks/session-eval.mjs --summary`. Across every registered project:
`agent-setup evals` (and the off-target ones, ranked, in `agent-setup report`). Both compare the
last 20 windows with the 20 before; with a baseline, `evals` also shows baseline against kit.

| Metric | Start by aiming for | When it is bad, pull this lever |
|---|---|---|
| code checked after its last edit | ≥ 90 % | configure gates (`/sdlc-init`); a `postEdit` check for the paths that break |
| last check passed | ≥ 90 % | read the failing windows: a flaky test, or work declared done too early |
| windows with unbacked check claims | 0 % | the stop-check catches most; an overlay line for the skill that over-claims |
| user corrections per prompt | ≤ 0.1 | retro: each correction is a lesson; route it to a guard, gate or overlay |
| task prompts that say how done is checked | ≥ 50 %, rising | the intake tip teaches it; show the team the "How to ask" table in WORKFLOW.md |
| tool calls that failed | ≤ 5 % | `signals.jsonl` keys: wrong cwd, missing tool, a wrong assumption about the project |
| tool output wasted | ≤ 3 % | re-reads of unchanged files: read discipline in the project's AGENTS.md section |
| heavy output re-read per window | falling | `heavy.top` in the rows names the read or command; scout, ranged reads, quieter commands |
| cache hit rate | ≥ 90 % | something rewrites the start of the context mid-session: a changing AGENTS.md or CLAUDE.md, model switches |
| cost per window (input-token equivalents) | falling against your own history | shorter windows (handoff), the scout for exploration, fewer heavy reads |

Two more lines under the table: **subagents used** (which reviewers and helpers actually ran —
a team that never sees `code-reviewer` is not getting reviews) and **briefs per task prompt**
(whether intake is happening). The targets live in code beside the metrics (`METRICS` in
`kit/hooks/_transcript.mjs`); they are starting points. The trend against your own history is
the signal. A single window proves nothing: compare 20 with 20, and read the windows behind a
change before believing it.

## 4 · The weekly cycle

About 45 minutes, same day every week.

1. **`agent-setup report --harvest`** — collects the projects' proposals into `inbox/`, then
   prints the next actions, ranked, each with its command: broken installs, regressions,
   proposals waiting, retros due, baselines ready to switch, provisional gates, outdated
   projects, metrics off target, weak eval buckets, skills with no lift over vanilla.
   `--md <file>` writes the same as Markdown for the team (it names projects: keep it out of
   this repository).
2. **Retros where the report says** — `/self-improve retro` in each project named. It routes
   lessons to the strongest form (guard → gate → overlay → rule → lessons.md) and exports the
   universal ones.
3. **Harvest** ([maintaining/harvest.md](maintaining/harvest.md)) — triage every proposal: accept, merge, defer or reject, each
   recorded. Accepted ones become the smallest skill edit plus a regression eval case.
4. **Measure the change** before shipping it (§5, §6).
5. **Release** ([maintaining/release.md](maintaining/release.md)), then `agent-setup update --all` (dry run first).
6. **Write the experiment** in §7: what changed, which metric should move, and — from the
   next report onwards — whether it did.

## 5 · Deciding what to change

- **Evidence first.** A lesson from one project goes into that project's overlay. It enters the
  kit when it would trip a competent agent in any repository *and* comes with a regression
  case, or when the same lesson shows up in two projects.
- **One change per metric at a time**, with the metric and the direction written down (§7).
  Two changes aimed at one number make the result unreadable.
- **Description edits** (when a skill loads) → rerun that skill's trigger suite and the routing
  suites it could steal from: `agent-setup eval-routing --suite all --skill <s> --save`.
- **Content edits** (what a skill teaches) → `agent-setup eval-outcomes --skill <s> --save`:
  the kit's score must hold, and its lift over vanilla must not drop.
- **A skill with no lift** (≤ 0 over vanilla, in two runs) teaches nothing the model does not
  already know and costs context in every session: sharpen its "mistakes that matter", or
  remove it.
- **Revert rule.** A release that makes a metric clearly worse across 20 windows in two
  projects is reverted or fixed before anything else ships.
- **Never `evals --promote` to turn a red gate green** without reading every failing case.

## 6 · Outcome evals — the kit against vanilla

`agent-setup eval-outcomes --skill <s> --save` runs each case in the skill's `evals.json` twice
in fresh scratch projects — once with the kit installed as a team gets it (skills, agents,
hooks, AGENTS.md), once with nothing — and a separate grader run, blind to which is which,
checks each result against the case's expectations, using everything the agent wrote and did
in order (a brief written before the first edit counts), its final reply and the files it
changed.

- **Cost**: cases × 2 agent runs (+ a one-turn grader run each). One skill is 6–10 runs;
  `--max-runs` caps a pass and a usage limit stops it. Spread a full pass over days.
- **Read**: `kit` is gated by `evals --check` like the other suites; `vanilla` sits beside it,
  and `lift` (kit minus vanilla, in points) is the answer to "does this skill earn its place?".
- **Noise**: one run per case moves in steps of a whole expectation. Before believing a lift
  under 15 points, rerun with `--runs 3`.
- **"skill did not load"** beside a kit result means the routing failed, not the content: the
  fix is the description (trigger suite), not the body.
- **`--setup skills`** measures the skills and agents alone (no hooks or AGENTS.md); the default
  measures the whole system.

## 7 · Experiment log

One row per kit change that aims at a number. Generic only — no project names (this
repository is public).

| Date | Kit | Change | Expect (metric, direction) | Result after 20+ windows | Verdict |
|---|---|---|---|---|---|
| _yyyy-mm-dd_ | _x.y.z_ | _what changed_ | _e.g. task prompts that say how done is checked ↑_ | _before → after, n windows, k projects_ | _keep · adjust · revert_ |

## 8 · Rolling out to a team

- **Before**: the baseline (§1), and `/sdlc-init` once the kit is on — without verified gates
  the stop-check can only ask for "the test and lint commands".
- **The 15-minute demo**, live in the team's repository:
  1. a small fix → made, checked and reported, with no ceremony;
  2. a risky change ("add refunds to checkout") → the brief, corrected in one line, the plan,
     the reviewer agent's findings;
  3. a blocked command (a push to production) → the alternative the hook names;
  4. a correction ("no, use the existing helper") → the lesson captured;
  5. `/ship-it` → the commit and the pull request.
- **Hand out** `.agents/WORKFLOW.md`. In Claude Code the session start links the skills in each
  clone (then `/reload-skills`); other agents read `.agents/` directly.
- **First week**: read `signals.jsonl` and the first retro for friction; fix it with overlays,
  not by turning hooks off. Agents other than Claude Code get AGENTS.md and the skills; the
  enforcement for them, and for people, is branch protection on the git host — set it.

## 9 · Release

[maintaining/release.md](maintaining/release.md): `npm run check`, the eval suites the changes could move, `evals --check`
(read every failing case; accept intended changes with `evals --promote`, never to turn a red
gate green unread), the version bump, then `agent-setup update --all --dry-run` and the rollout
when you say so. CI runs `npm run check` and `evals --check` on every pull request, and `main` accepts nothing else, so a committed
scorecard that regressed cannot land quietly.

## 10 · When something is off

| Symptom | Do |
|---|---|
| The brief appears on prompts that did not need one | note the prompts in the retro; the rubric lives in `kit/hooks/_prompt.mjs` (a kit change, with a test). A team that truly does not want it: `workflow.promptIntake: false`, with the reason in lessons.md |
| The stop-check blocks, but nothing can be checked here | the agent says so in one line and the next stop goes through; add gates with `/sdlc-init` |
| The context-budget note comes too early for your model | raise `workflow.contextWarnTokens` (1M-context models: 300000 is reasonable) |
| A project is missing from `report` / `evals` | it is not in the registry (`~/.agent-setup/projects.json`): `agent-setup update <project>` registers it |
| An eval run prints "errored and were not scored" | a usage or rate limit: the runner stops at the first one; rerun later. Errored runs never enter a scorecard |
| A full eval pass would eat the week's usage | rerun only the touched skills (`--skill`), cap with `--max-runs n`, spread a full pass over days — merged scorecards keep every bucket |
| A trigger bucket regressed | read the failing queries first; fix the description, or the case if the case was wrong |
| You want the session line at every start | `workflow.sessionSummary: true`; `.agents/learnings/` must exist (the admin role creates it) and a window must have ended or compacted. A baseline install never shows it |

## Configuration

`.agents/sdlc.config.json`, section `workflow`, with its defaults:

```json
{ "workflow": { "sessionSummary": false, "verifyBeforeStop": true, "contextWarnTokens": 150000,
                "promptIntake": true, "retroEvery": 20, "askBranch": false } }
```

Change one only with a reason, and put the reason in `.agents/docs/lessons.md`.
`sessionSummary: true` shows the person one line of metrics at session start (the admin reads
the same numbers with `agent-setup evals`); `askBranch: true` makes the agent ask which branch
to work on before its first edit instead of deciding and naming it. `retroEvery` is when
`agent-setup report` lists a retro as due.
