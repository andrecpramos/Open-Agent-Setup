# {{PROJECT_NAME}} — Project Overview

> **Audited against the tree:** {{DATE}}
> The cold-start document. An agent that reads only this file and
> [rules.md](rules.md) should be able to start work without breaking anything.

## What this is

{{ONE_PARAGRAPH. What the project does, for whom, and the single sentence that
distinguishes it from the obvious alternative. If that sentence is hard to write,
that difficulty is the most useful thing on this page — record it rather than
papering over it.}}

## Current state

The point of this table is that it is **honest about the difference between
scaffolded and working**. "Complete" means it does its job under test, not that
files exist.

| Area | Status |
|---|---|
| {{AREA}} | ✅ complete — {{what proves it}} |
| {{AREA}} | 🟡 partial — {{what works, what does not}} |
| {{AREA}} | ⬜ not started |
| {{AREA}} | ⛔ deliberately empty — see {{ADR}} |

## Environment facts (verified {{DATE}})

Verified means *run on this machine*, not *read in a manifest*. The gap between
the two is where most lost afternoons come from.

- Working directory: `{{PATH}}`
- {{TOOL}} `{{VERSION}}` — {{available / missing / required despite the manifest saying otherwise}}
- {{Anything installed that the manifest does not mention, or vice versa}}

> **Survey:** run the version command for every tool in `sdlc.config.json`'s
> `project.stack` and record the real output. Where a manifest's declared minimum
> is wrong in practice, say so here and say what actually fails — "Node 20
> installs fine and fails at run time" is worth more than `engines: >=20`.

## Open risk

{{The assumption that, if wrong, invalidates the most work. One risk, not a
register — the register lives in the roadmap. State what would falsify it and
what test is outstanding.}}

If there is no such risk, write "none identified" and be suspicious of that.

## Document map

| File | Answers |
|---|---|
| [rules.md](rules.md) | The numbered invariants and where each is enforced |
| [critical-infrastructure.md](critical-infrastructure.md) | What is actually enforced, and the gaps |
| [lessons.md](lessons.md) | Dated lessons this repo taught the hard way |
| [decisions/](../decisions/) | ADRs — the binding technical choices |
| [overlays/](../overlays/) | How the kit's skills apply here: architecture, security, testing and the rest |

## Known stale

{{Documents that no longer match the tree, what specifically is stale, and
whether the staleness is cosmetic or structural.}}

This section exists because the alternative — silently stale documents — costs
more. A document marked stale is still useful; one that is wrong and unmarked is
worse than absent. Where the *architecture* a document describes is unchanged and
only its examples name a superseded library, say exactly that: the reader can
then still trust the shape.

Prefer leaving a stale document marked over having an agent rewrite it, when what
replaces the stale part has not actually been decided. An agent's plausible guess
becomes a cited decision nobody made.

## Non-negotiables

The short version of [rules.md](rules.md) — the three or four that, if broken,
mean the project is no longer the thing it set out to be.

1. {{RULE}}
2. {{RULE}}
3. {{RULE}}
