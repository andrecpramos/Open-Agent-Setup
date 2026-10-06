---
name: self-improve
description: >
  Route the lessons captured in .agents/learnings/inbox.md to where they are enforced — a
  hook, gate, skill overlay, path-scoped rule or dated lesson — run the retrospective over the
  session metrics, and export lessons that would help any project back to the Agent_Setup kit.
  Admin role, run by name. Use for "/self-improve retro", "/self-improve capture <lesson>",
  "/self-improve export", or when `agent-setup report` says lessons are waiting or a retro is
  due.
disable-model-invocation: true
---

# Self-improvement loop

Lessons die with the context window unless they are written down — and a lesson written in a
document is the weakest form it can take, read only by an agent that already suspects a
problem. This skill captures lessons cheaply, then pushes each one as far up the enforcement
ladder as it will go:

**hook or gate** (fires whether anyone remembers or not) › **skill overlay** (loads when the
work matches) › **path-scoped rule** (loads when the files match) › **lessons document** (read
on purpose).

Modes: **capture** (one lesson, now), **retro** (process the inbox and this session),
**export** (universal lessons → the kit), **status**. Use the mode named in the invocation
arguments, or infer it from the situation.

## Before you start

- Read `.agents/overlays/self-improve.md` if it exists — this project's adaptation of this
  skill; it wins where they disagree.
- The entry format is in `.agents/learnings/README.md`. The kit's version and location are in
  `.agents/agent-setup.json` (`kit.version`, `kit.source`).

## Capture

When: the user corrected you · a non-obvious fact cost you real time · a kit skill's advice was
wrong or missing here · a command failed three times before you found the cause.

1. **Finish or stabilise the user's request first.** Capturing never outranks what they asked
   for — unless the lesson *is* what they asked for.
2. **Append one entry** to `.agents/learnings/inbox.md`:

   ```markdown
   ## 2026-09-26 — Regenerate the Prisma client after schema edits
   - **What happened:** typecheck passed locally, CI failed — the client was generated from the old schema.
   - **Lesson:** after editing prisma/schema.prisma, run `pnpm db:generate` before typecheck or tests.
   - **Evidence:** CI job `typecheck`, error TS2339 on `order.status`.
   - **Scope:** project
   - **Skill:** backend
   ```

   The lesson line is an instruction whose violation someone could recognise. "Be careful with
   migrations" is not a lesson; the entry above is.
3. **Standing rules are routed immediately.** If the user said "remember", "from now on",
   "always" or "never", run the retro routing for that entry now — a standing rule left in an
   inbox is a rule nobody follows.
4. **Tell the user in one line:** "Noted in .agents/learnings/inbox.md: <lesson>."

## Retro

1. **Gather** — inbox entries; the friction log `.agents/learnings/signals.jsonl` (the same
   `key` failing repeatedly, within or across sessions); the numbers, from
   `node .agents/hooks/session-eval.mjs --summary`; and this session: the user's corrections,
   approaches that failed, facts you had to discover, skill guidance you had to override.
   A metric that got worse is a lesson candidate even when the inbox is empty. Find its
   windows in `.agents/learnings/eval-windows.jsonl`: `claims.unverified`,
   `verification.after_last_edit: false`, `tools.repeated_failures`, `heavy.top` (which
   read or command filled the context), `prompt_quality` (task prompts that never said how
   done is checked, and whether a brief followed) and `tools.agents` (which reviewers actually
   ran — risky changes with no reviewer are a lesson for the deliver overlay).
2. **Filter.** Keep a lesson only if (a) a future session would plausibly get it wrong without
   it, (b) it changes behaviour rather than recording trivia, and (c) it is not already
   recorded — search overlays, `.claude/rules/` (Claude Code), `.agents/docs/lessons.md`, AGENTS.md and the
   skills first. A duplicate strengthens the existing entry (new date, more evidence); it does
   not become a second one.
3. **Classify the scope:**

   | Scope | Test | Home |
   |---|---|---|
   | project | true because of *this* repo's code, conventions, tooling or history | this repo |
   | universal | a competent agent would get it wrong in *any* repo with this stack or domain — you can state it without naming this project | the kit, via export |
   | personal | a preference of this user, not a property of the code | the user's own memory — ask first |

   When torn between project and universal, choose project: a kit change reaches every
   project and needs stronger evidence than one incident.
4. **Choose the strongest form for each project lesson:**

   | The lesson is… | Put it in… |
   |---|---|
   | "this command or pattern must never happen" | `guard.extraDeny` in `.agents/sdlc.config.json` (`pattern`, `reason`, `instead`), or a gate |
   | "CI should catch this" | a gate in `.agents/sdlc.config.json` plus its check — then make it fail once on purpose |
   | "after editing these paths, check that" | a `postEdit` entry (`paths` + a sub-second `run`, or a `remind` text) |
   | how a kit skill should work in this repo | `.agents/overlays/<skill>.md` |
   | context needed whenever certain files are touched | Claude Code: `.claude/rules/<topic>.md` with `paths:` frontmatter; other agents: the overlay of the skill for that area |
   | a fact nearly every task needs | the project section of AGENTS.md — keep it short |
   | an incident, a background fact, a dated gotcha | `.agents/docs/lessons.md`, append-only |
   | a multi-step procedure with a correct order and a skipped step, seen twice | a project skill in `.agents/skills/<name>/` — see `sdlc-init`'s workflow rules |

   `.agents/sdlc.config.json`, `.claude/settings.json` and `.agents/hooks/` are protected: show
   the exact change and let the user approve it. Worked examples:
   [references/routing-examples.md](references/routing-examples.md).
5. **Universal lessons → export** (below). **Personal ones →** propose auto memory,
   `CLAUDE.local.md` or the user's global instructions; never write user-level files unasked.
6. **Mark processed.** Move each entry from `inbox.md` to `.agents/learnings/archive/YYYY-MM.md`
   with a final line `→ routed to: <destination>`. The inbox is empty after a retro, except for
   entries deliberately kept with `(deferred: <reason>)`.
7. **Report** a table — lesson · destination · form · the metric it should move — plus any
   change waiting for approval, and the summary rows as they stand, so the next retro can see
   whether the routing worked.

## Export — universal lessons to the kit

Kit-owned files (`.agents/skills/<kit skill>/`, the kit's agents, `.agents/hooks/`) are never
edited to teach them something: `agent-setup update` would overwrite the change and every other
project would miss it. Write a proposal to `.agents/learnings/outbox/YYYY-MM-DD-<skill>-<slug>.md`:

```markdown
# Proposal: <one-line change>
- **Skill:** <kit skill, or "new skill">  · **Kit version:** <kit.version> · **Date:** YYYY-MM-DD
- **Seen in:** <stack and kind of project — no names needed>

## What happened
<two to four sentences; no secrets, personal data or proprietary code beyond a minimal snippet>

## The lesson
<the rule, stated generally>

## Why it is universal
<why a competent agent would get this wrong in another repository>

## Proposed change
<which section of the skill, and the new or replacement text>

## Regression case
<a realistic prompt and the expectations that fail without the change>
```

Then tell the user once: "N proposal(s) are ready for the kit — run
`node "<kit.source>/bin/agent-setup.mjs" harvest`, then follow docs/maintaining/harvest.md in
the kit." Until the kit ships the improvement, put the same guidance in this project's overlay
so work here benefits immediately.

## Status

Report: inbox entries, outbox proposals, overlays present, the date of the last retro (newest
archive entry), the top repeated failure keys in `signals.jsonl`, and the summary rows from
`node .agents/hooks/session-eval.mjs --summary`.

## Rules of thumb

- Five lines per lesson; evidence beats adjectives.
- First occurrence → capture. Second → promote to an overlay, rule or gate. By the third it
  should already be mechanical.
- Delete a lesson that turned out wrong, and say why in the archive — contradictory lessons
  are worse than none.
- Nothing secret or personal in learnings, overlays or proposals: they are committed, and
  proposals leave the repository.
- Never quietly weaken a kit skill's advice in the project. If it is wrong, export a
  proposal and state the project's exception in the overlay.

## Done means

- **Capture:** one well-formed inbox entry, and standing rules routed at once.
- **Retro:** inbox empty or explicitly deferred; every lesson routed in its strongest form;
  protected changes proposed; universal lessons in the outbox; the report table given.
