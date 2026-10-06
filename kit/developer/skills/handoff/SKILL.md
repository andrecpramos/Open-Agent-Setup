---
name: handoff
description: >
  Write a precise handoff so the next session — or another agent, or a human — can continue
  without re-deriving context: the goal, what is done with evidence, what is in progress,
  decisions and their reasons, open questions, exact next steps, and the branch and
  working-tree state. Use when the user says "handoff", "wrap up", "save progress", "I'll
  continue later", "write up where we are", before /clear or a long break, or whenever a task
  has to pause mid-way.
---

# Handoff

The next session starts with none of this conversation. A good handoff lets it resume in five
minutes instead of fifty — and it is the only defence against the most expensive failure of
long work: redoing something that was already done, or undoing a decision nobody wrote down.

## Before you start

- Read `.agents/overlays/handoff.md` if it exists; it wins where it disagrees.
- **Where it goes:** if `.agents/sdlc.config.json` names a living plan document (`docs.plan`),
  update its status section. Otherwise write `.agents/handoffs/YYYY-MM-DD-<slug>.md`, and ask
  whether handoffs are committed in this repo before staging one.

## Gather facts, not memories

```bash
git branch --show-current
git status --short
git log --oneline <integration>..HEAD
git stash list
gh pr status            # if the GitHub CLI is available
```

Plus the last gate results (or run the fast gates now) and the list of files changed in this
session.

## Write it

```markdown
# Handoff — <task> — YYYY-MM-DD HH:MM

**Goal:** <what the user asked for, in their words>
**Branch:** feature/orders-cancel — 3 ahead, 0 behind develop · uncommitted: src/a.ts, src/b.ts · stash: none · PR: #123 (draft)

## Done — with evidence
- Cancel endpoint returns 409 for shipped orders — `orders.cancel.test.ts` passes (commit a1b2c3d)

## In progress
- Refund on cancel — stopped at src/orders/refund.ts:88; the gateway call is written, not tested

## Decisions
- Refund asynchronously via the outbox, not inline — the gateway takes up to 8 s (see ADR-012)

## Open questions for the user
- Partial refunds for partially shipped orders? Default if no answer: refund unshipped items only

## Next steps, in order
1. `pnpm vitest run src/orders/refund.test.ts` — write the failing test for the async refund first
2. …

## Gotchas found
- The payment sandbox rejects amounts under 0.50 € — also in .agents/learnings/inbox.md
```

Every "done" item carries evidence (a test, a command's output, a commit). Every next step is
concrete enough to execute without this conversation. Nothing secret goes in.

## Then

- Capture the session's lessons (`self-improve`, capture mode) — the gotchas section is not
  their only home.
- Tell the user where the handoff is, and the first next step.
