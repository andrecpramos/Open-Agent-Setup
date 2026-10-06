---
name: backend
description: >
  Design, implement, review or debug server-side code — domain logic, services and use cases,
  persistence, schema and migrations, transactions and concurrency, background jobs and
  queues, caching, error handling, logging and observability, and backend tests — in any
  stack (Node, Python, Java/Kotlin, Go, .NET, Ruby, Rust, PHP). Use whenever a task touches a
  service, repository, ORM model, SQL, migration, worker (Celery, Sidekiq, BullMQ), cron job
  or cache (Redis), or a bug like "duplicate records", "the job ran twice", "charged twice",
  "slow endpoint", "data got corrupted" or "works locally, times out in prod"; also
  correlation ids and structured logs, and tests whose database differs from production. Load
  it before the first change, even if the user never says "backend". For the shape of
  HTTP/GraphQL/gRPC contracts use api-design; for vulnerabilities and auth design use security.
---

# Backend engineering

Everything above you assumes you are right. The backend holds the state and enforces the
invariants, and its mistakes are quiet: a corrupted row does not throw, a lost update does not
log, a duplicate charge looks like a successful one. Design for the failure paths first — they
are the ones discovered in production.

## Before you start

1. **Read the overlay.** `.agents/overlays/backend.md`, if it exists, is this project's
   adaptation of this skill and wins where they disagree.
2. **Map the layers from the code.** Where do requests enter (handler, controller, resolver,
   consumer)? Where does logic live (service, use case, domain model)? Where is persistence
   (repository, ORM, query builder)? Which migration tool runs, and how? New code goes in the
   layer its neighbours use: no business rules in controllers, no HTTP or ORM types in the
   domain, no queries in views or templates.
3. **Find the invariants** before changing anything that writes: `.agents/docs/rules.md`,
   ADRs, schema constraints, validation code, and comments that say *must* or *never*. An
   invariant you haven't found is one you are about to break.
4. **Copy the local conventions** for errors, logging, configuration, transactions and tests
   from existing code rather than introducing your own.

## Workflow

1. **Write down the behaviour and its failure modes** before the code: invalid input, missing
   record, conflict, dependency down or slow, the same request arriving twice, two requests
   racing. Decide what each one does. Written second, the failure branch is written last, and
   last means never.
2. **Write the failing test** — including a negative case — against real infrastructure where
   behaviour depends on it (the database above all). [references/testing.md](references/testing.md)
3. **Model values so invalid states can't be represented.** Parse at the boundary into
   domain types once, then trust them inward. Money in integer minor units or a decimal type,
   never floats. Time as UTC instants with explicit zones at the edges. Identifiers opaque.
4. **Implement in the right layer**, with a transaction around exactly what must be atomic —
   and no network calls inside it.
5. **Schema changes are migrations that survive a rolling deploy** (expand → migrate →
   contract). [references/data-and-migrations.md](references/data-and-migrations.md)
6. **Make it observable** — a structured log at each decision and failure point, carrying the
   correlation id; no secrets or personal data. [references/observability.md](references/observability.md)
7. **Run the gates**, including the integration suite.

## The mistakes that matter

- **Check-then-act races.** "If it doesn't exist, insert it" and "read, modify, write" are
  broken under concurrency: two requests both see "not used" and both redeem the coupon. Use
  the database: a unique constraint and handle the conflict (upsert / `ON CONFLICT`), an
  atomic conditional update (`UPDATE … SET used = true WHERE id = $1 AND used = false`, then
  check the affected row count), optimistic locking with a version column, or an explicit
  `SELECT … FOR UPDATE` when you really need the lock.
- **Side effects inside a transaction.** An email, event or HTTP call made inside a
  transaction that later rolls back announces something that never happened; one made after
  commit that then fails loses the event. Use a transactional outbox, or an after-commit hook
  plus an idempotent consumer. [references/reliability.md](references/reliability.md)
- **Network calls while holding a transaction or lock** — one slow dependency exhausts the
  connection pool and the whole service stalls.
- **N+1 queries** from lazy loading in a loop. Eager-load, join, or batch (dataloader); read
  the query log for the code path you touched.
- **Unbounded reads** — no `LIMIT`, offset pagination over millions of rows, whole tables
  loaded into memory, `SELECT *` on wide tables in hot paths.
- **A new query pattern without an index.** Check the plan (`EXPLAIN (ANALYZE, BUFFERS)` on
  realistic data) for anything that filters, joins or sorts on a large table. Foreign keys are
  not automatically indexed in PostgreSQL.
- **SQL built by string concatenation**, anywhere, for any reason — parameterise.
- **Swallowed errors** — `catch {}` that returns success, or a generic 500 with the cause
  thrown away. Handle what you can, rethrow with context what you can't, and never leak stack
  traces, SQL or internal identifiers to clients.
- **External calls without a timeout**, retries without backoff and jitter, and retries of
  operations that are not idempotent.
- **Jobs assumed to run exactly once.** Queues and schedulers deliver at least once; handlers
  must be idempotent, poison messages need a dead-letter path, and messages should carry ids,
  not large payloads that go stale.
- **Caches without an invalidation story** — or per-user data cached under a shared key, which
  is a data leak, not a performance bug.
- **Configuration read ad hoc** from the environment all over the code, unvalidated. Parse
  and validate config once at startup and fail fast.
- **Tests that mock the database** for behaviour the database decides (constraints,
  transactions, locking, SQL dialect), or run on SQLite/H2 when production is PostgreSQL. They
  pass, and production fails.
- **Editing an applied migration** or shipping a destructive change in one step.
- **A deploy path checked by reading it.** A Dockerfile that installs before copying what a
  postinstall step needs (an ORM schema, say) fails on every clean build, and a health
  check against `localhost` can hit `::1` while the server listens on IPv4. Verify a deploy
  change with a no-cache image build, then run the exact health-check command against the
  booted container; use `127.0.0.1`, not `localhost`.

## Done means

- The gates pass, including integration tests against a real database — or you say
  explicitly that they could not run and why.
- Failure paths are tested, not just described: invalid input, not found, conflict or race,
  dependency failure.
- Migrations were applied to a non-empty database; anything that locks or rewrites a large
  table was called out with its expected impact.
- New queries on large tables have a supporting index, with the plan checked.
- Failure points log with a correlation id; nothing secret or personal is logged.
- If this changed a documented contract, schema or invariant, the project's docs say so
  (`.agents/docs/`, ADRs, API spec).

When the repo taught you something the code didn't say, add it to
`.agents/learnings/inbox.md`.
