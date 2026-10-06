# Routing examples

Each example: the inbox entry, where it goes, and the exact change.

## 1 · A command that must never run → guard rule

> **Lesson:** never run `npm run db:reset` — it drops the shared development database every
> preview environment reads. Use `npm run db:reset:local`.

`.agents/sdlc.config.json` (protected — propose to the user):

```json
"guard": {
  "extraDeny": [
    {
      "pattern": "npm\\s+run\\s+db:reset(?!:local)",
      "reason": "db:reset drops the shared development database every preview environment reads.",
      "instead": "npm run db:reset:local"
    }
  ]
}
```

In Claude Code the guard hook now denies it at the moment of temptation, with the alternative
in the denial.

## 2 · A check after editing certain files → postEdit

> **Lesson:** after editing `prisma/schema.prisma`, the client must be regenerated or types are stale.

```json
"postEdit": [
  { "paths": ["prisma/schema.prisma"], "remind": "Schema changed — run `pnpm db:generate` before typecheck/tests, and add a migration." }
]
```

Use `run` instead of `remind` only for commands well under a second.

## 3 · Something CI should catch → a gate

> **Lesson:** two PRs this month imported `src/infra` from `src/domain`.

Add a boundary check (dependency-cruiser, import-linter, ArchUnit…), wire it as a gate:

```json
{ "id": "boundaries", "title": "Rule 1 — domain never imports infra", "command": "npx depcruise src --config .dependency-cruiser.cjs", "blocking": true, "rule": "1", "fix": "Depend on a port in src/domain; implement it in src/infra." }
```

Then break it on purpose once (a scratch import), confirm the gate fails, revert, and record
the date in `.agents/docs/critical-infrastructure.md`.

## 4 · How a kit skill should work here → overlay

> **Lesson:** this repo's forms use Formik + yup, not React Hook Form; field errors come from
> `mapApiErrors()` in `src/lib/forms.ts`.

`.agents/overlays/frontend.md`:

```markdown
## Forms
- Formik + yup (not React Hook Form). Map API 422 errors with `mapApiErrors()` from `src/lib/forms.ts`.
```

## 5 · Context for certain files → path-scoped rule

> **Lesson:** migrations in `db/migrations/` must be reversible, and a column is never dropped
> in the same release that stops using it.

`.claude/rules/migrations.md` (Claude Code; other agents get the same line in the overlay):

```markdown
---
paths:
  - "db/migrations/**/*.sql"
---
# Migration rules
- Every migration has a matching down migration that restores the previous schema.
- Dropping a column takes two releases: stop reading it first, drop it in the next one.
```

(Claude Code loads it when those files are read; other agents get the same content if you also
reference it from the overlay of the relevant skill.)

## 6 · A dated incident → lessons.md

> **Lesson:** the payment provider's sandbox account is reset on the first day of every month —
> test customers created there disappear.

`.agents/docs/lessons.md`:

```markdown
### 2026-03-12 — The payment sandbox resets monthly
The provider wipes the sandbox account on the first of each month. Don't rely on test customers created there; create them in the test's setup.
```

## 7 · Universal → export to the kit

> **Lesson:** agents write `useEffect` fetches for search inputs and ship the stale-response race.

That is not specific to this repository; it belongs in the `frontend` skill. Write
`.agents/learnings/outbox/2026-03-12-frontend-search-race.md` in the proposal format, with a
regression case (prompt + expectations). Meanwhile, add a one-line reminder to
`.agents/overlays/frontend.md` so this project benefits before the kit ships the change.

## 8 · Personal → ask

> **Lesson:** the user prefers short status updates and metric units.

Not a property of the code. Offer: "Shall I save this to your personal memory
(auto memory / `~/.claude/CLAUDE.md`)?" — and write only if they agree.
