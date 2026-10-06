# The self-improvement loop

The goal: every project the kit is installed in makes the agents better — in that project
immediately, and in every other project once a lesson proves universal. The loop is the admin
role's (`kit/admin/`): developers' sessions only sense and capture, silently or in one line;
routing, retros and harvesting are run by whoever maintains the setup. `--roles developer`
installs no loop at all.

## The loop

```
  in a project                                              in Agent_Setup
  ─────────────────────────────────────────────────         ─────────────────────────────────
  1 SENSE      learning-signals hook
               · user correction ("I told you…", "não faças…")
               · the same call failing 3× (friction log)
               session-eval hook
               · facts per context window (eval-windows.jsonl): checks,
                 claims, corrections, prompt quality, subagents used
               · --summary for the table (a session-start line is opt-in)
               prompt-intake · stop-check · context-budget hooks
               · act on the same facts while the work happens
                         │
  2 CAPTURE    the agent, in the developer's session
               one entry → .agents/learnings/inbox.md (format in its README)
                         │
  3 ROUTE      /self-improve retro (admin, by name) — strongest form first
               agent-setup report says when entries wait or a retro is due
               guard rule / gate / postEdit ──┐
               skill overlay                  ├─ project: enforced here, now
               path-scoped rule               │
               lessons.md                   ──┘
               universal? ──────────▶ .agents/learnings/outbox/<proposal>.md
                                                 │
  4 HARVEST                                      └──▶ agent-setup harvest ──▶ inbox/
                                                                                 │
  5 TRIAGE                                              harvest (docs/maintaining/)
                                                        accept → edit the kit skill
                                                               + regression eval case
                                                        merge / defer / reject (recorded)
                                                                                 │
  6 RELEASE                                             release — lint, tests, version,
                                                        changelog
                                                                                 │
  7 DISTRIBUTE  ◀──────────── agent-setup update --all ◀─────────────────────────┘
                every project gets the improved skill; local overlays keep working
```

## Why each step is shaped the way it is

**Sense with hooks, not instructions.** An instruction to "record your lessons" is read at
session start and forgotten by the first correction. The `learning-signals` hook fires *at*
the correction — the moment the lesson is cheapest to capture — and is deliberately narrow (it
scans only the opening of a prompt, ignores quoted and fenced text, and recognises English and
Portuguese corrections), because a noisy channel teaches the agent to ignore it.

**Capture is five lines, and never outranks the user's request.** The inbox format (date, what
happened, lesson, evidence, scope, skill) is small enough to write mid-task and structured
enough for a retro to route.

**Route on the admin's schedule, not in the developer's session.** Up to 2.x every session
start could tell the agent that lessons were waiting or a retro was due, and the agent passed
that on to whoever was working — the wrong person, at the wrong moment. Now `agent-setup report`
lists both for the admin, and `self-improve` runs only when invoked by name.

**Route to the strongest form.** A lesson in a document is read only by an agent that already
suspects a problem. A guard rule fires whether or not anyone remembers. So the retro pushes
each lesson as far up the ladder as it will go: guard/gate → `postEdit` → overlay → path rule →
AGENTS.md → `lessons.md`. This is the SDLC layer's enforcement principle ([SDLC.md](SDLC.md)) applied to learning.

**Never edit kit-owned files in a project.** The next `update` would overwrite the change and
every other project would miss it. Project-specific adaptations go in overlays; universal ones
become proposals.

**Universal needs evidence.** A kit change reaches every project, so a proposal must argue why a
competent agent would get this wrong *anywhere*, and bring a regression case. When in doubt, a
lesson is project-scoped.

**Pull, don't push.** Projects never write into the kit: they write proposals into their own
outbox, and `agent-setup harvest` (run in the kit) collects them from every registered project.
No cross-repository permissions are needed, and nothing reaches the kit without a maintainer's
triage.

**Every accepted lesson becomes an eval case.** That is what stops the next edit of a skill
from quietly un-learning it (see `kit/developer/skills/agent-eval/references/skill-evals.md`).

## Other self-improvement channels

- **Reviewer memory.** `security-reviewer`, `architecture-reviewer` and `docs-keeper` run with
  `memory: project`: they keep a curated memory of the repo's primitives, boundaries and drift
  sources in `.claude/agent-memory/<agent>/` (committed, so the team shares it) and read it
  before each review.
- **Friction analysis.** `signals.jsonl` (local, redacted, bounded) shows which commands fail
  repeatedly; the retro turns recurring friction into an overlay line, a `postEdit` check or a
  fix to the environment.
- **Description tuning.** Trigger evals (`evals/trigger.json`) plus the skill-creator's
  description optimiser keep skills loading for the right requests as the kit grows.
- **The kit against vanilla.** `agent-setup eval-outcomes` runs each skill's eval cases with
  the kit installed and without it, graded blind. The lift says whether a skill earns the
  context it costs; a skill with none is sharpened or removed.
- **Baseline against kit.** A project installed with `--setup measure` records how its team
  works without the kit; after `update --setup full`, `agent-setup evals` puts the two side by
  side. It is the only comparison made on real work rather than eval cases.

## Operating it

| When | Where | Command |
|---|---|---|
| a correction or a costly surprise | project | the agent captures it (hook-prompted), or `/self-improve capture …` |
| end of a substantial session | project | `/self-improve retro` |
| weekly | kit | `node bin/agent-setup.mjs report --harvest` — the next actions, ranked; then [harvest](maintaining/harvest.md) |
| `status` or `harvest` shows universal lessons waiting in an inbox | project | `/self-improve retro` there: the kit only receives what reaches the outbox |
| after accepted changes | kit | the evals they could move (`eval-routing` for descriptions, `eval-outcomes` for content), then [release](maintaining/release.md) |
| after a release | kit | `node bin/agent-setup.mjs update --all` |
