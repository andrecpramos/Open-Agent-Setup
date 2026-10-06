# The rules

> **Audited against the tree:** {{DATE}}

Numbered invariants. Every one is either enforced by something mechanical or
labelled as a convention — there is no third category, and a rule with no
enforcement is a rule that will be broken by someone in a hurry.

**Numbers are permanent.** A retired rule keeps its number and gets a
`~~strikethrough~~` with a pointer to what replaced it. Renumbering breaks every
reference in commit messages, PR reviews, code comments and CI job names.

Where a rule is enforced is tracked in
[critical-infrastructure.md](critical-infrastructure.md), which is the document to
read before trusting that any of this is protected.

## Format

| # | Rule | Enforced by | Kind |
|---|---|---|---|
| 1 | {{The invariant, in one sentence, stated as a prohibition or an obligation}} | `{{gate id, hook, or test}}` | gate / hook / test / **convention** |

`convention` in the Kind column means **nothing checks this**. That is a legitimate
state — some rules cannot be mechanised — but it must be visible, because a reader
who assumes a convention is a gate will ship the violation.

## The rules

| # | Rule | Enforced by | Kind |
|---|---|---|---|
| 1 | {{RULE}} | {{ENFORCEMENT}} | {{KIND}} |
| 2 | {{RULE}} | {{ENFORCEMENT}} | {{KIND}} |
| 3 | {{RULE}} | {{ENFORCEMENT}} | {{KIND}} |

> **Survey:** rules come from four places, in descending order of authority —
> ADRs (binding), the README/CONTRIBUTING (stated), CI job names (implied), and
> code comments saying "never do X" (discovered). Collect all four. Do not invent
> a fifth. A repo with three real rules is better served by three than by fifteen
> aspirational ones, because a long list of unenforced rules teaches readers that
> the list is decorative.

## How to add a rule

A rule earns its number when **all four** hold:

1. Breaking it is expensive and not locally obvious — the damage shows up
   somewhere other than where the mistake was made.
2. It can be stated as a prohibition or an obligation, not a preference.
   "Prefer composition" is a standard; "core must never import a domain" is a rule.
3. Someone can say what a violation looks like concretely.
4. There is a plan for how it is enforced — even if that plan is
   "convention for now, gate at {{milestone}}".

If it fails (1), it is a convention: it belongs in the overlay of the skill for that area
(`.agents/overlays/<skill>.md`), or in the conventions section of AGENTS.md.
If it fails (4), add it anyway and mark it `convention` — an honest gap on the
register beats an unwritten rule, which is enforced by nothing *and* invisible.

## How to retire a rule

Strike it through, keep the number, name what replaced it and why. If it is being
retired because it was inconvenient rather than wrong, that is a decision worth an
ADR — rules do not usually stop being true, they stop being obeyed, and the two
look identical six months later.

| # | Rule | Enforced by | Kind |
|---|---|---|---|
| ~~{{N}}~~ | ~~{{RETIRED RULE}}~~ → superseded by rule {{M}} / [ADR-{{NNN}}]({{path}}) | — | retired {{DATE}} |
