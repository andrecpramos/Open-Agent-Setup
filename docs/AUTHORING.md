# Authoring kit skills

The quality bar for the skills written here (own skills), and the rules for the ones taken
from elsewhere (vendored skills). Skills live in their role's folder — `kit/developer/skills/`
for what developers' agents use, `kit/admin/skills/` for setting the kit up and improving it —
own and vendored side by side; `kit/vendor.json` says which is which. `agent-setup lint`
enforces the mechanical parts; this document is the rest.

## The test a skill must pass

**It encodes what a competent agent would otherwise get wrong.** If a skill restates what the
model already does well, it costs context on every invocation and teaches nothing. The value
is in the sentences that begin "the mistake here is…".

**And a normal project uses it.** A skill's description loads into every session of every
project that installs it. Something only a few projects need — image-only deliverables,
aesthetic presets, one model family's quirks — costs everyone else context and steals prompts;
it stays out of the kit, or opt-in behind a profile.

## Anatomy

```
kit/<role>/skills/<name>/
├── SKILL.md            ≤ 500 lines (aim for 150–250); loaded when the skill triggers
├── references/*.md     depth, loaded on demand; > 300 lines needs a "Contents" section
├── scripts/*.mjs       deterministic helpers (zero-dependency Node) — executed, not read
├── assets/             templates and files used in outputs
└── evals/              evals.json + trigger.json — stay in the kit, never installed
```

`SKILL.md` structure, in this order:

1. **Frontmatter** — `name` (= folder name) and `description` only, unless a Claude-only key
   earns its place (`context: fork` for heavy, self-contained procedures). Admin skills also
   set `disable-model-invocation: true` (lint checks it): they run when invoked by name, and
   their descriptions never enter a developer's session.
2. **One paragraph** — the job and the boundary.
3. **Before you start** — must include reading `.agents/overlays/<name>.md` (lint checks it),
   then where to find the project's own context.
4. **The procedure** — steps in the correct order, with real commands.
5. **The mistakes that matter** — the failures agents actually make, each with why and how to
   detect it. The reason the skill exists.
6. **Done means** — checkable evidence, not "looks right".
7. A closing line pointing at `.agents/learnings/inbox.md` for lessons.

## The description decides everything

It is the only text an agent sees before deciding to load the skill.

- Say **what it does and when to use it**, in the words a user types — file types, error
  messages, phrasings, including indirect ones ("the page flickers"). Agents under-trigger
  skills, so be explicit.
- Name the near-misses and **where they go instead** ("for tokens use design-system"). This is
  what keeps thirty skills from fighting over one request.
- ≤ 1024 characters (Agent Skills spec); Claude Code truncates description + `when_to_use` at
  1,536.

## Writing style

- Explain **why**. A rule with its reason generalises; a bare MUST gets misapplied.
- Concrete over general: a grep recipe beats "look for issues".
- Don't invent numbers. Cite a standard (WCAG, OWASP, Core Web Vitals) or say the project
  decides.
- Version-sensitive facts carry a "check the installed version" caveat.
- Portable: no single vendor's tool names in procedures that other agents run ("fetch the
  URL", "run the command"); say "the gate-runner agent (Claude Code)" when referring to
  Claude-specific delegation. Link other skills by relative path (`../<skill>/SKILL.md`) as
  well as by name, so agents without skill auto-loading can follow them, and declare needed
  CLIs, network access or image generation in `compatibility`.

## Evals

Every domain skill ships:

- `evals/evals.json` — 3+ realistic tasks with `expected_output` and `expectations` (checkable
  statements). Prefer expectations that *discriminate* — ones that fail without the skill.
- `evals/trigger.json` — 16–20 queries: 8–10 that should trigger (varied, some indirect, some in
  Portuguese), 8–10 near-misses that belong to sibling skills.

### Outcome evals — the skill against vanilla

```bash
node bin/agent-setup.mjs eval-outcomes --skill <name> --save          # each case, kit and vanilla
node bin/agent-setup.mjs eval-outcomes --skill <name> --only 2 --runs 3
```

Each `evals.json` case runs in two fresh scratch projects — the kit installed as a team gets
it, and nothing — and a grader run that never learns which is which checks everything the
agent wrote and did, in order, its final reply and the files it changed against the case's
`expectations`. The scorecard's buckets are the
kit arm (gated by `evals --check`); the vanilla arm sits beside them, and the **lift** is the
difference. A skill whose lift stays at zero teaches nothing the model does not already know:
sharpen it or remove it. Write expectations the grader can see in the work — a test it wrote,
a command it ran, a reviewer it called, a sentence in its report — not intentions. A case that
names files needs them to exist: give the skill an `evals/fixture/` (a small project, shared
with its routing suite) and both arms run inside it; otherwise write the case so it stands on
its description alone. Every missed expectation prints the grader's reason; read those before
changing anything (`--verbose` adds the reply and the tools used). The
skill-creator skill remains useful for description optimisation (see
`kit/developer/skills/agent-eval/references/skill-evals.md`).

### Routing tests

A skill that routes to others (`deliver`) also ships
`evals/routing.json`: prompts, and the skill a real agent must pick **first**, the skills or
agents it must use at some point (**`need`**, with `a|b` for alternatives), or **`none`**,
judged only within the suite's `scope` — skill names, `@group`, or `agent:<name>` for a
subagent the agent should delegate to — so other kit skills may fire alongside without failing
a case. `forbid` lists skills that must not fire; `when` marks a case that needs a capability
(`image-generation`, `gpt-model`…) and is skipped unless `--assume` declares it. A suite can
name a `fixture` folder under `evals/`: each case then runs in a copy of it, committed on a
`develop` branch, with its `.pending/` files laid over as uncommitted changes — what a "review
my changes" case needs.

```bash
node bin/agent-setup.mjs eval-routing                        # Claude Code, the kit's skills copied into each case
node bin/agent-setup.mjs eval-routing --skill deliver
node bin/agent-setup.mjs eval-routing --cmd '["codex","exec","--json","{prompt}"]' --assume gpt-model,image-generation
```

The runner counts a skill as used when the agent invokes it or opens its `SKILL.md`, reading
only tool-call inputs, never tool results (a router's body names every other skill). Run it
after changing any description or the router: a harmless-looking description edit can steal
prompts from another skill. The Codex line is an example command; for a non-Claude agent,
install the kit into a project first.

The same runner executes every skill's `evals/trigger.json` (`--suite trigger`, or `all`): a
`should_trigger` query passes when the skill loads at any point, a near-miss when it never
does, and a positive case stops as soon as its skill loads. The default agent runs with
project settings only, so the user's own plugins stay out of the measurement. `--runs n`
repeats every case (flaky ones show as such); `--save` merges the buckets that ran into
`scorecards/<suite>.latest.json`. A run that errored (no output, a usage or rate limit) is
reported and never scored. `agent-setup evals --check` compares the latest scorecards with
their baselines, allowing for sampling noise, and CI runs it; `evals --promote` accepts a
reviewed change as the new baseline (the latest file becomes the baseline; the next run
starts from it). A full pass is about 200 agent runs and real usage: after editing one skill,
rerun its suites with `--skill`; rerun everything only when a description changed.

### The official validator

`PYTHONUTF8=1 skills-ref validate kit/<role>/skills/<name>` (`pip install skills-ref`) checks a skill
against the Agent Skills spec. On Windows it crashes without `PYTHONUTF8=1` on any SKILL.md
containing typographic quotes. `agent-setup lint` applies the same rules to vendored skills,
and `vendor sync` refuses to finish if one breaks them.

## Changing a skill

1. Edit the smallest section that fixes the problem; keep the structure.
2. Add or update an eval case that captures the change.
3. `npm run check` (lint + tests).
4. Changelog entry under *Unreleased*; release when ready ([maintaining/release.md](maintaining/release.md)).

## New skill

```bash
node bin/agent-setup.mjs new-skill <name> --group domain --summary "one line for AGENTS.md"
```

creates a scaffold that already passes the structural lint, and registers it in the catalog.
Add it to the right profiles in `kit/catalog.json`. `--group admin` scaffolds it in
`kit/admin/skills/`, with `disable-model-invocation: true`; every other group serves the
developer role.

## Vendored skills — taking someone else's skill

```bash
node bin/agent-setup.mjs import https://github.com/<owner>/<repo>/tree/<ref>/<path/to/skill> [--name x] [--license MIT]
```

adds the source to `kit/vendor.json` and runs `vendor sync`, which copies the skill verbatim
into `kit/developer/skills/<name>/` (vendored skills serve the developer role), writes the
source's licence once to `kit/developer/licenses/<source>.txt`
(shared by every skill from that source), adds a `license` line pointing at it, records the
commit in `kit/vendor.lock.json` and checks the Agent Skills spec. Then add the skill to
`kit/catalog.json` (group and profiles) and review every script it ships before any project
installs it. Good sources include [anthropics/skills](https://github.com/anthropics/skills).

The rules, because the next sync overwrites the folder:

- **Never hand-edit a vendored folder.** Change the frontmatter through an override in
  `vendor.json` — `description` (to route better or name near-misses), `compatibility` (to
  declare requirements), `removeKeys` (to drop keys outside the spec) — with a `why`. The body
  cannot be patched; if it is wrong, fix it upstream, exclude the skill, or write an own skill.
- **One version of a skill.** Two versions compete for the same prompts; list the loser under
  `excluded` with its `why` (`vendor sync` then stops warning about it).
- **Conflicts with an own skill are settled in the own skill** (a "Not for …" line in its
  description, a rule in its body) or by an override of the vendored one's description — never
  by patching the vendored body.
- **Taking upstream changes** is `agent-setup vendor status` (what moved), `vendor sync` (take
  it), then a review of the diff — an upstream rule change lands unreviewed otherwise.
  `vendor sync --locked` rebuilds exactly the recorded commits.
- **Licences live once, in `kit/developer/licenses/`.** Never copy one into a skill folder in the kit
  (lint fails on identical files). A skill folder that leaves the kit on its own gets its
  licence from `agent-setup export`.
- **Promote** a vendored skill into an own skill only by rewriting it to this bar, with evals,
  and removing it from `vendor.json`.
