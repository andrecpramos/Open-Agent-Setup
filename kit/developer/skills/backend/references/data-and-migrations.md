# Data modelling and migrations

## Contents

1. Let the database enforce the invariants
2. Types that don't lie
3. Indexing
4. Zero-downtime migrations (expand → migrate → contract)
5. PostgreSQL specifics
6. MySQL specifics
7. Backfills
8. Transactions and isolation
9. Pagination
10. Multi-tenancy and soft delete

## 1 · Let the database enforce the invariants

Application checks are advisory under concurrency; constraints are not. Every invariant that
can be a constraint should be one:

- `NOT NULL` for required fields, `UNIQUE` for natural keys and idempotency keys, `FOREIGN KEY`
  for references (with a deliberate `ON DELETE`), `CHECK` for ranges and enum-like columns.
- Partial unique indexes for "unique among active rows"
  (`CREATE UNIQUE INDEX … ON coupons (code) WHERE deleted_at IS NULL`).
- Exclusion constraints (PostgreSQL) for "no overlapping bookings".

Then handle the constraint violation in code and map it to a domain error (409 Conflict at
the API).

## 2 · Types that don't lie

| Value | Store as | Not |
|---|---|---|
| Money | integer minor units, or `numeric(19,4)` + currency code | `float`, `double`, `real` |
| Instant | `timestamptz` (PG) / UTC `DATETIME` + app convention | naive local time |
| Calendar date / local time | `date`, `time` + an explicit time-zone column when needed | a timestamp at midnight |
| Identifiers | UUID (v7 or ULID for index locality) or bigint internally; opaque externally | sequential ids exposed in URLs where enumeration matters |
| Enum-like | text + `CHECK`, or a native enum when changes are rare | free text |
| Flexible attributes | JSONB for genuinely schemaless data | JSONB for data you query and constrain every day |

## 3 · Indexing

- Index every foreign key you join or delete by (PostgreSQL does not do it for you).
- Composite index column order: equality columns first, then range/sort columns.
- Partial indexes for hot subsets (`WHERE status = 'pending'`); covering indexes
  (`INCLUDE`) for index-only scans on hot reads.
- Verify with `EXPLAIN (ANALYZE, BUFFERS)` on production-like volume — the planner chooses
  differently on an empty table.
- Every index slows writes and costs memory; remove unused ones (`pg_stat_user_indexes`).

## 4 · Zero-downtime migrations

During a rolling deploy, old and new code run against the same schema at the same time. Every
migration must be compatible with **both**. The pattern:

1. **Expand** — additive only: new nullable column, new table, new index (concurrently).
2. **Deploy code that writes both** old and new shapes (dual-write), reads the old.
3. **Backfill** existing rows in batches (§7).
4. **Deploy code that reads the new shape.**
5. **Enforce** — `NOT NULL`, constraints, validation (see §5 for doing it without long locks).
6. **Contract** — stop writing the old shape; later, drop it in its own migration.

Never in one step: rename a column, change a column's type, drop a column still read by
running code, add `NOT NULL` without a default to a populated table.

Rules that hold regardless of tool:

- **Applied migrations are immutable.** Fix forward with a new migration.
- Migrations are code-reviewed like code and run in CI against a real database.
- Separate schema changes from large data changes.
- Know your tool's transaction behaviour (Flyway/Liquibase/Prisma/Alembic/Rails/Knex/goose
  differ on whether each migration is wrapped in a transaction — and `CREATE INDEX
  CONCURRENTLY` cannot run inside one).

## 5 · PostgreSQL specifics

- Set `lock_timeout` (e.g. `SET lock_timeout = '5s'`) in migrations so a blocked `ALTER`
  fails fast instead of queueing every query behind it.
- `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` for tables in use.
- `ADD COLUMN … DEFAULT <constant>` is metadata-only since PG 11; a volatile default
  (`now()`, `gen_random_uuid()`) rewrites the table.
- Adding `NOT NULL` to a big table: `ADD CONSTRAINT … CHECK (col IS NOT NULL) NOT VALID`,
  then `VALIDATE CONSTRAINT` (takes a weaker lock), then `SET NOT NULL` (PG 12+ uses the
  validated check and skips the scan).
- Foreign keys on large tables: add `NOT VALID`, then `VALIDATE CONSTRAINT` separately.
- Changing a column type usually rewrites the table — add a new column and migrate instead.

## 6 · MySQL specifics

- InnoDB online DDL (`ALGORITHM=INPLACE/INSTANT, LOCK=NONE`) covers many changes; check which
  operations are instant in the running version.
- For large tables, use an online schema change tool (gh-ost, pt-online-schema-change) as the
  project does.
- `utf8mb4`, never `utf8` (which is 3-byte and truncates emoji).

## 7 · Backfills

- In batches (1–10k rows) keyed by primary key, committing each batch; sleep between batches
  if replication lag or load matters.
- Idempotent and resumable: re-running must not double-apply; record progress or derive it
  from the data (`WHERE new_col IS NULL`).
- Run as a job or script, not inside the schema migration's transaction.
- Measure on a copy of production volume before running for real.

## 8 · Transactions and isolation

- Most databases default to READ COMMITTED: two concurrent read-modify-write transactions
  both succeed and one update is lost. Protect with atomic updates, `SELECT … FOR UPDATE`,
  optimistic version checks, or SERIALIZABLE + retry on serialization failure.
- Keep transactions short; never await network I/O inside one.
- Nested "transactions" in ORMs are often savepoints — know what a rollback inside does.
- Deadlocks: touch rows in a consistent order; retry the whole transaction on a deadlock
  error.

## 9 · Pagination

- **Keyset (cursor)** for large or changing sets: `WHERE (created_at, id) < ($1, $2) ORDER BY
  created_at DESC, id DESC LIMIT 50`, with an index on `(created_at, id)`. Stable under inserts.
- **Offset** only for small, mostly static sets; `OFFSET 100000` scans and discards 100k rows.
- Always cap the page size server-side.
- Exact total counts on big tables are expensive; return `hasMore`, or an estimate, unless the
  product truly needs the number.

## 10 · Multi-tenancy and soft delete

- Multi-tenant tables carry `tenant_id` in every query path. Enforce it structurally — a
  repository that requires the tenant, row-level security, or schema-per-tenant — not by
  remembering to add a `WHERE`. A missing tenant filter is a data breach.
- Soft delete (`deleted_at`) must be applied everywhere reads happen (default scopes, views)
  and interacts with unique constraints (use partial unique indexes). Prefer hard delete plus
  an audit/archive table when regulations require erasure (GDPR): soft-deleted personal data
  is still stored personal data.
