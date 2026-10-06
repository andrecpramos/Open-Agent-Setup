# The enforcement audit

The method behind the most valuable output of `sdlc-init` and `enforcement-audit`: **what
does this repo claim, and what does it actually enforce — and for whom?**

## The premise

> A written rule is obeyed until someone is in a hurry.

Most repositories state more rules than they enforce, and nobody has a list of which is
which. The gap is invisible until it costs something, because a rule and an enforced rule look
identical in a document. An audit that produces "12 claims, 4 enforced, 8 convention — here are
the 8, ranked" tells you where the next hour of tooling should go.

## The one question

For every claim, ask: **what would fail if someone broke this?**

| Answer | Status |
|---|---|
| A CI job that blocks a merge | enforced |
| A test that would fail | enforced |
| A type that would not compile | enforced |
| A git hook (pre-commit/pre-push) | enforced — for every agent and human, unless bypassed with `--no-verify` |
| A Claude Code hook that would deny it | enforced — **Claude Code sessions only** |
| A gate that runs but does not block | partial |
| "Review would catch it" | **convention** |
| Nothing | **convention** |

"Code review" is not enforcement. It is a convention with better public relations. And a rule
enforced only by a Claude Code hook is unenforced for Codex, Cursor or a human — say which
agents each mechanism covers.

## Where claims hide

In descending order of authority: **ADRs** (binding by construction) → **README,
CONTRIBUTING, AGENTS.md, CLAUDE.md** (stated) → **CI job names** (implied) → **code comments
saying "never do X"** (discovered — the most under-harvested):

```bash
rg -n -i "(never|must not|do not|always) (import|commit|edit|call|use|push|run)" --glob '!node_modules' .
```

## Two traps that look exactly like enforcement

### The vacuous gate

It runs, reports green, checks nothing. One repository had a CI step named
*"generated artefacts are current"* that built domain A and diffed the output directory of
domain B — files that build never writes. It passed on every PR for weeks while real drift went
ungated. It happens when a path is renamed, a glob stops matching, an assertion runs over an
empty collection, a filter excludes everything. None of these fail — they pass faster.

**Catch it:** name the path, symbol or fixture each gate reads in the register; and **make
every gate fail on purpose once, and record that you did.** A gate nobody has seen fail is a
gate nobody knows works — this is the only habit that produces evidence rather than confidence.

### The blocking claim that isn't

A CI job blocks a merge **only if branch protection requires it.** Otherwise it goes red and
the merge button still works. Check, don't assume:

```bash
gh api repos/{owner}/{repo}/branches/{branch}/protection --jq '.required_status_checks.contexts'
gh api repos/{owner}/{repo}/rulesets
```

A 403/404 here (plan limits, permissions) means you could not verify — mark the gate
`partial` and say so. Some plans offer no branch protection on private repositories (the call
returns 403): there, a CI job named as the repository's enforcement blocks nothing, and every
"blocking" claim in the docs is policy, not mechanism.

## Ranking the gaps

**Blast radius first, cost to fix second** — not by ease; the easy ones get done anyway.

| # | Gap | Blast radius | Cheapest fix | Effort |
|---|---|---|---|---|

For blast radius answer two things: what silently goes wrong, and **how long before anyone
notices**. Every row names a fix a single session could implement: "improve test coverage" is
not a row; "add `check-x.mjs` to the gate list and make it fail on the known-bad fixture" is.

## Reporting

Lead with the count: *"N claims, M enforced, K convention"* — and, where it matters, *"of the
M, J hold only in Claude Code sessions"*. Don't editorialise about the ratio; a young repo
with three enforced rules out of twelve is normal. The value is that the repo now knows which
nine are unprotected.

End with one next action — the single cheapest fix with the largest blast radius, as a command
or a file.

## Keeping it honest

- Re-audit on any CI change, any new gate, any new rule, and at every release.
- Never claim protection that does not exist; a register that overstates coverage converts an
  unknown risk into a false assurance.
- When a rule graduates from convention to gate, update the register, the rule list and the
  "seen failing" table in the same commit.
