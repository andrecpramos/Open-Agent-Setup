---
name: enforcement-audit
description: >
  Audit what this repository claims against what it actually enforces — collect the rules
  stated in ADRs, README, CONTRIBUTING, AGENTS.md/CLAUDE.md, CI job names and "never do X" code
  comments; find the CI job, test, type, git hook or agent hook that would fail if each were
  broken, and which agents it covers; catch vacuous gates and blocking claims with no branch
  protection behind them; write the ranked gap register (.agents/docs/critical-infrastructure.md)
  and end with one next action. Admin role, run by name. Use when asked "what is actually enforced?", "are our gates
  real?", to audit CI, rules or process, before a release, or after CI changes.
compatibility: "In Claude Code this skill runs in a forked context; other agents run it inline, which works but fills the current context. The forking keys (context, agent, background) are Claude Code-only, so agent-setup export removes them for claude.ai upload and strict Agent Skills validators."
context: fork
agent: general-purpose
background: false
disable-model-invocation: true
---

# Enforcement audit

Everything else the kit installs is setup; this is the deliverable. A written rule is obeyed
until someone is in a hurry, and a rule looks exactly the same in a document whether or not
anything enforces it. This audit makes the difference visible. The method, the traps and the
ranking rules are in [references/enforcement.md](references/enforcement.md) — read it first.

Read `.agents/overlays/enforcement-audit.md` if it exists; it wins where it disagrees.

## Procedure

1. **Collect the claims**, each with its source:
   - ADRs (`.agents/decisions/` or the repo's ADR folder) — binding;
   - `README`, `CONTRIBUTING`, `AGENTS.md`, `CLAUDE.md`, `.agents/docs/rules.md` — stated;
   - CI job and step names — implied;
   - code comments: `rg -n -i "(never|must not|do not|always) (import|commit|edit|call|use|push|run)"` — discovered.
   Deduplicate, and number them to match `rules.md` where it exists.
2. **For each claim, find what would fail if someone broke it** — and read it, don't trust its
   name: the CI `run:` lines, the test's assertions, the hook's code, the lint rule's config. Note
   **who it covers**: CI and branch protection cover everyone; git hooks cover every agent and
   human in a clone unless bypassed; Claude Code hooks cover Claude Code sessions only;
   instructions cover no one who hasn't read them.
3. **Check "blocking"** against branch protection or rulesets
   (`gh api repos/{owner}/{repo}/branches/{branch}/protection`, `gh api repos/{owner}/{repo}/rulesets`).
   A CI job not required by protection is `partial`. Couldn't check (403, no `gh`)? Say so.
4. **Hunt vacuous gates**: a glob that matches nothing, a path renamed out from under a check,
   an assertion over an empty collection, a diff of a directory the build never writes. For
   each gate you can, **make it fail on purpose** (a scratch change in a throwaway branch or
   stash) and record the date and method — then restore everything.
5. **Write the register** — create or update `.agents/docs/critical-infrastructure.md` from the
   template at `.agents/skills/sdlc-init/assets/templates/docs/critical-infrastructure.md`, and
   keep `rules.md`'s "Enforced by" column consistent with it. Status values: **enforced ·
   partial · convention · broken**, and the coverage (all / git-hook users / Claude Code only).
6. **Rank the gaps** — blast radius first (what silently goes wrong, and how long until anyone
   notices), cost to fix second. Every row names a fix one session could implement.

## Report

```
14 claims · 5 enforced (1 Claude Code only) · 2 partial · 7 convention · 0 broken

Top gaps
1. "Production moves only on request" — Claude Code hook only; Codex/Cursor sessions and humans
   are unprotected. Blast radius: an unreviewed push to main deploys; noticed after deploy.
   Fix: branch protection on the git host — required pull request and checks on main. S
2. "Domain never imports infra" — convention; 3 violations today. Fix: dependency-cruiser rule
   as a blocking gate; fail it once on purpose. S
…
Seen failing this audit: lint (2026-09-26, unused import in scratch file)

Next action: <the single cheapest fix with the largest blast radius, as a command or a file>
```

Lead with the counts; don't editorialise about the ratio — a young repo with few enforced rules
is normal. The value is that the unprotected ones now have names.

## Rules

- **Never claim protection that does not exist.** Overstated coverage converts an unknown risk
  into a false assurance — worse than no register.
- **Read-only by default.** The audit writes the register and nothing else; closing a gap is a
  separate change the user approves. The deliberate-failure checks are always reverted.
- **End with exactly one next action.** A list gets deferred; one action gets done.
