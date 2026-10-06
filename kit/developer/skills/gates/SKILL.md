---
name: gates
description: >
  Run this repository's quality gates — lint, typecheck, tests, boundary and security checks —
  exactly as CI runs them, cheapest first, from .agents/sdlc.config.json, and report PASS/FAIL
  per gate with the fix hint for each failure. Use before committing or opening a PR, after a
  multi-file change, and whenever the user asks "is it green?", "run the checks", "will CI
  pass?" or "verify this". Delegate to the gate-runner agent when the output would flood the
  conversation. Not for deciding which gates should exist (sdlc-init) or auditing whether they
  are real (enforcement-audit).
---

# Gates

A gate is only worth something if the local run and the CI run are the same commands. This
skill runs the list in `.agents/sdlc.config.json` — the one place the gate commands are
defined — so "passes here" means "passes in CI".

## Before you start

- Read `.agents/overlays/gates.md` if it exists; it wins where it disagrees with this file.
- If `.agents/sdlc.config.json` is missing or has no gates, say so and suggest `sdlc-init`.
  You may still run the project's obvious checks (the lint/typecheck/test scripts in AGENTS.md)
  as an **advisory** pass — and label it that way, because nobody has verified they match CI.

## Run them

```bash
node .agents/skills/gates/scripts/run-gates.mjs            # diff-scoped (`when`), stop at first blocking failure
node .agents/skills/gates/scripts/run-gates.mjs --all      # every gate, ignoring `when`
node .agents/skills/gates/scripts/run-gates.mjs --continue # don't stop at the first failure
node .agents/skills/gates/scripts/run-gates.mjs --only lint,typecheck
node .agents/skills/gates/scripts/run-gates.mjs --json     # for tooling
```

(Claude Code reaches the same script through `.claude/skills/gates/`.) Exit code 0 means every
blocking gate passed; 1 means a blocking gate failed; 2 means there is no usable config.

In Claude Code, when a full run would produce more output than is useful here, delegate to the
`gate-runner` agent and act on its verdict.

## Reading the result

- **PASS / FAIL** per gate, with the last 40 lines of a failure's output and the gate's `fix`
  hint. Start from the `fix` hint; it is what the repo learned about that gate.
- **FAIL (advisory)** — a `blocking: false` gate failed. Report it; it does not block.
- **RAN (non-zero by design)** — `expectNonZero` gates exit non-zero on purpose; their verdict
  comes from a comparison step, not the exit code.
- **skipped** — a gate with `when` globs that the diff does not touch. Before a PR into the
  integration branch, run `--all` once.
- **timed out** — counts as failed. An inconclusive gate fails closed.

## The mistakes that matter

- **"Fixing" a gate by weakening it** — skipping or deleting tests, adding `--passWithNoTests`,
  lowering thresholds, `eslint-disable` sprinkled to get to green, `--no-verify`. Fix the cause,
  or stop and report the failure. Changing a gate's definition is a change to
  `sdlc.config.json`, which the user approves.
- **Running a tidier equivalent** instead of the configured command (`pnpm test` instead of
  `pnpm -r test`). It passes locally, fails in CI, and teaches everyone to stop trusting `/gates`.
- **The same command in a different environment.** A newer local Node major (flags and APIs CI
  lacks) or packages present only in a sub-package's `node_modules` make a local pass
  meaningless. After changing tooling, config or CI itself, run the gates in a fresh clone with
  only CI's install step, on the Node major from the CI workflow (e.g. `docker run node:20`).
- **Reporting green from a partial run** — say which gates were skipped and why.
- **Blaming flakiness without evidence.** Re-run once; if it passes, report it as flaky with
  both outputs — a flaky gate is a finding for `enforcement-audit`, not a pass.
- **Failures in code you didn't touch** are still failures. Report them separately from
  failures your change caused, with evidence for which is which (e.g. the gate fails on the
  base branch too).

## Report

```
BLOCKED — 2 passed, 1 failed (typecheck), 1 skipped (e2e: no matching changes)
typecheck: src/orders/service.ts:41 — Property 'status' does not exist on type 'Order'
  fix hint: run `pnpm db:generate`, then re-run
Caused by this change: yes — the schema edit in prisma/schema.prisma
```

## Done means

Every blocking gate passed in a run you can quote — or the failures are reported with cause,
evidence and whether this change introduced them.
