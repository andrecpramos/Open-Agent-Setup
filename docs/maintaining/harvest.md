# Harvest — from project lessons to kit improvements

For whoever maintains the kit, with any agent or by hand: follow it when the weekly report
(`agent-setup report`) shows proposals waiting, or when `inbox/` has files. An agent asked to
"harvest", "process the inbox" or "see what the projects learned" follows this page.

A proposal arrives with one project's evidence; accepting it changes the skill for every
project. The job is to let through what is genuinely universal, make the smallest change that
teaches it, and pin it with an eval so it is never un-learned.

## 1 · Collect

```bash
node bin/agent-setup.mjs harvest            # every registered project
node bin/agent-setup.mjs harvest --from <project>
```

Proposals land in `inbox/` as `YYYY-MM-DD--<project>--<file>.md`.

Then read the numbers across every registered project:

```bash
node bin/agent-setup.mjs report             # the next actions, ranked (report --harvest does the collect too)
node bin/agent-setup.mjs evals              # scorecards vs baseline, session metrics, baseline vs kit
```

A metric that is bad in several projects (code not checked after its last edit, heavy output
re-read, repeated failures) points at a kit skill, hook or template that is not doing its job,
even when no project wrote a proposal about it. Treat it as a proposal with cross-project
evidence.

## 2 · Judge each proposal

Read the proposal and the current skill section it targets. Decide with these questions:

| Question | If no |
|---|---|
| Is there concrete evidence (error, file:line, user correction)? | defer — ask for evidence |
| Would a competent agent get this wrong in a *different* repo with this stack/domain? | reject as project-specific — it belongs in that project's overlay |
| Is it already covered (search the skill, its references, sibling skills)? | merge — strengthen the existing wording or example instead |
| Does it contradict existing guidance? | resolve explicitly: which is right, and when? Never leave both |
| Is it stated generally (no project names, no proprietary code)? | rewrite it before applying |

Outcomes: **accept**, **merge** (into existing text), **defer** (needs evidence or a second
occurrence), **reject** (with the reason).

## 3 · Apply an accepted change

1. Edit the **smallest** section that teaches the lesson — usually one bullet in "The mistakes
   that matter", or a line in a reference. Keep each skill under its structure and budget
   (see `docs/AUTHORING.md`).
2. Add a regression case to `kit/<role>/skills/<skill>/evals/evals.json` (next id, `expectations`
   as checkable strings). Write it as a fresh scenario that fails the same way: never the
   project's own file names, class names, identifiers or story. If the lesson is about *when*
   a skill should load, add queries to `evals/trigger.json` instead.
3. If the proposal needs a new skill: `node bin/agent-setup.mjs new-skill <name>` and write it to
   the authoring bar — only when two or more proposals point at the same gap.
4. `npm run check` — lint and all tests must pass.
5. Changed a description, a router table or when a skill should load? Rerun its suites:
   `node bin/agent-setup.mjs eval-routing --suite all --skill <skill> --save`, then
   `node bin/agent-setup.mjs evals --check`. A description change reruns every suite, because
   it can steal prompts from other skills. Changed what a skill teaches? Its outcome suite,
   before the release: `node bin/agent-setup.mjs eval-outcomes --skill <skill> --save` (cases
   × 2 agent runs; ask before spending them).
6. Write the change in the experiment log (`docs/PLAYBOOK.md` §7) when it aims at a number:
   the metric, the direction, and — from the next reports — whether it moved.

## 4 · Record the decision

Move each processed proposal to `inbox/processed/` (gitignored, like all of `inbox/`) and
add at its top:

```markdown
> **Decision (YYYY-MM-DD):** accepted | merged | deferred | rejected — <one line why>
> **Changed:** kit/<role>/skills/<skill>/SKILL.md § <section>; evals/evals.json #<id>
```

Add a line per accepted or merged change to `CHANGELOG.md` under **Unreleased**, describing
the guidance, not where it came from.

## 5 · Report

A table — proposal · decision · change — and the suggestion to release ([release.md](release.md))
when the Unreleased section is worth shipping.

## Boundaries

- Never hand-edit a vendored skill folder (`kit/vendor.json` lists them): a proposal for a
  vendored skill becomes an override in `kit/vendor.json` with a `why`, a row in the router's
  conflict table, or an upstream report.
- This repository is public and serves every project. Nothing that identifies a project
  reaches a committed file: no names, paths, file or class names, people or incidents, in
  skills, evals, docs, tests or the changelog. Keep triage notes in `inbox/`, which is
  gitignored. Never paste project code or data beyond a minimal, generic snippet.
- Don't release from here; that is [release.md](release.md).
