# Critical infrastructure and the rules that bind it

> **Audited against the tree:** {{DATE}}
> Re-audit trigger: any change to CI, any new gate, any new rule, or a release.

Every component whose failure is not a local bug, the rules that govern it,
**where each rule is actually enforced**, and whether it is currently obeyed.

The distinction that runs through this whole document is between a rule that is
*written down* and a rule that is *enforced*. A written rule is obeyed until
someone is in a hurry. Every row below says which kind it is, and
[the gap list](#enforcement-gaps-ranked) collects the ones that are still only
written down.

**Nothing here claims protection that does not exist.** If a cell says
`convention`, there is no gate. That honesty is the entire point of the document —
a register that overstates coverage is worse than no register, because it converts
an unknown risk into a false assurance.

Rule numbers refer to [rules.md](rules.md). The ADRs in [decisions/](../decisions/)
are the constitution; this file maps how they are held up.

---

## How to read a section

Each component gets four things:

- **What** — the component, in one sentence, in terms of what it is responsible for.
- **Blast radius** — what breaks elsewhere when this breaks. If the answer is
  "just this", it does not belong in this document.
- **The table** — rule → enforcement → status. Enforcement names a *runnable
  thing*: a gate id from `sdlc.config.json`, a hook, a specific test. "Code review"
  is not an enforcement; it is a convention with better PR.
- **Known fragility** — the thing that will break next, stated before it does.

Status values: **enforced** · **enforced (fixed {{DATE}})** · **partial** ·
**convention** · **broken**.

---

## 1 · {{COMPONENT}}

**What.** {{One sentence. What it is responsible for.}}

**Blast radius.** {{What silently goes wrong elsewhere when this is wrong. Be
specific — "the router reaches a route that does not exist" beats "navigation
breaks".}}

| Rule | Enforcement | Status |
|---|---|---|
| Rule {{N}} — {{short form}} | `{{gate id}}` in CI, `{{file:symbol}}` locally | **enforced** |
| Rule {{N}} — {{short form}} | none | **convention** |

> ⚠️ **Known fragility: {{the thing that will break next}}.**
> {{Why it is fragile, what specifically would trigger it, and what the fix would
> be. Naming a fragility before it fires is the cheapest thing in this document.}}

---

## 2 · {{COMPONENT}}

{{Repeat. Most projects have between three and seven of these. If you have
fifteen, the criterion is being applied too loosely — "whose failure is not a
local bug" is a high bar.}}

---

## Enforcement gaps, ranked

The list this document exists for. Ranked by **blast radius first, cost to fix
second** — not by how easy they are, because the easy ones get done anyway.

| # | Gap | Blast radius | Cheapest fix | Effort |
|---|---|---|---|---|
| 1 | Rule {{N}} is `convention` — {{what nothing checks}} | {{what goes wrong, and how long before anyone notices}} | {{a specific command or file, not "add a check"}} | {{S/M/L}} |
| 2 | {{GAP}} | {{...}} | {{...}} | {{...}} |

**Rule for this table:** every row names a fix that a single session could
implement. "Improve test coverage" is not a row. "Add `check-x.mjs` to the
`pre-merge` gate list and make it fail on the known-bad fixture" is.

---

## The failure mode this document is designed against

A gate can pass **vacuously** — run, report green, and check nothing.

The worked example from the repository this kit came from: a CI step named
"generated artefacts are current" diffed a directory that the build script never
wrote to. It passed on every PR for weeks while real drift went completely
ungated. Nothing was broken; the job was green; the check was decorative.

Three habits catch this class of problem, and only the third is reliable:

1. **Name what a gate checks, not what it is called.** A job name is marketing.
   This register records the path, symbol, or fixture the gate actually reads.
2. **State the blast radius.** A gate whose blast radius you cannot describe is
   usually not gating what you think.
3. **Make every gate fail on purpose, once, and record that you did.**
   A gate nobody has seen fail is a gate nobody knows works. This is the only one
   of the three that produces evidence.

| Gate | Last seen failing correctly | How it was made to fail |
|---|---|---|
| `{{gate id}}` | {{DATE}} | {{the deliberate break — e.g. "added a forbidden import to a scratch file"}} |

> **Survey:** for a brownfield install, this table starts empty and that is the
> honest state. Fill one row per session rather than claiming the set.
