# Reliability patterns

## Contents

1. Timeouts
2. Retries
3. Idempotency
4. Transactional outbox
5. Queues and consumers
6. Scheduled jobs
7. Multi-step workflows (sagas)
8. Circuit breakers, bulkheads, backpressure
9. Graceful shutdown

## 1 · Timeouts

Every call that leaves the process has a timeout: HTTP clients, database queries
(`statement_timeout`), cache calls, message publishes. Libraries often default to *infinite*.

- Set connect and total (or read) timeouts separately.
- Propagate deadlines: if the incoming request has 2 s left, an outgoing call should not be
  given 10 s.
- The timeout value comes from the dependency's observed latency (p99 + margin) or its SLA —
  say where the number came from.

## 2 · Retries

Retry only when the failure is **transient** (timeouts, 502/503/504, connection resets,
429 with `Retry-After`, deadlocks, serialization failures) **and** the operation is
**idempotent** (or made idempotent with a key).

- Exponential backoff with full jitter: `sleep = random(0, base * 2^attempt)`, capped.
- A small maximum (3–5 attempts) and an overall deadline.
- Never retry 4xx validation or auth errors.
- Beware retry amplification: every layer retrying 3× turns one user request into 27 calls
  at the bottom. Retry at one layer, ideally the one closest to the failure.

## 3 · Idempotency

An operation is idempotent when doing it twice has the same effect as doing it once. Make
writes idempotent wherever a client, queue or retry might repeat them:

- **Idempotency key** — the client sends a unique key per logical operation; the server
  stores `key → (request hash, result)` under a unique constraint, returns the stored result
  on a repeat, and rejects a reuse of the key with a different payload.
- **Natural idempotency** — `PUT` of a full resource, "set status to X" rather than "toggle",
  upserts keyed by a natural id.
- **Dedup on consume** — record processed message ids (unique constraint) in the same
  transaction as the effect.

## 4 · Transactional outbox

The problem: you must write to the database **and** notify something else (event bus, email,
webhook). Doing both "in order" loses one of them on a crash between the steps.

1. In the same transaction as the business write, insert a row into an `outbox` table
   (`id, type, payload, created_at, published_at NULL`).
2. A relay (poller or change-data-capture) publishes unpublished rows and marks them
   published.
3. Consumers are idempotent, because the relay can publish a row more than once.

Many frameworks ship this (Spring Modulith event publication registry, Debezium outbox,
MassTransit/NServiceBus outboxes, `transactional-outbox` libraries). Use the project's.

## 5 · Queues and consumers

- Delivery is **at least once**. Handlers must be idempotent.
- Messages carry identifiers and the minimum data needed; the consumer reads current state
  rather than trusting a snapshot that may be stale by the time it runs.
- Ordering is rarely guaranteed across partitions/consumers; don't depend on it unless the
  platform guarantees it for your key.
- Visibility timeout / ack deadline longer than the worst-case processing time, or
  heartbeat/extend it.
- Poison messages go to a dead-letter queue after N attempts, and something alerts on the
  DLQ depth. A DLQ nobody watches is a silent data-loss mechanism.
- Consumer concurrency is bounded; a consumer that can outrun its database is a denial of
  service on yourself.

## 6 · Scheduled jobs

- With more than one instance, a plain cron runs on each: use a distributed lock (ShedLock,
  advisory locks, a leader election) or a single scheduler.
- Jobs are idempotent and resumable; they record progress or derive it from data.
- Jobs emit a heartbeat/metric so a job that silently stops running gets noticed.

## 7 · Multi-step workflows

When a business operation spans services or external systems that cannot share a
transaction, model it as a saga: a sequence of local transactions with a **compensating
action** for each step (refund, release reservation, cancel shipment), driven by an
orchestrator or by events, with its state persisted so it survives restarts. Write the
compensation paths first; they are the part that gets skipped.

## 8 · Circuit breakers, bulkheads, backpressure

- **Circuit breaker** — after repeated failures, stop calling a dependency for a cool-down
  and fail fast (or serve a fallback). Protects both sides.
- **Bulkhead** — separate pools (connections, threads, concurrency limits) per dependency so
  one slow dependency cannot consume all capacity.
- **Backpressure** — bound queues and concurrency; shed load with 429/503 + `Retry-After`
  instead of accepting work you cannot finish.
- **Fallbacks** must be explicit and honest: stale data labelled as stale, a degraded feature
  hidden — never a fabricated value.

## 9 · Graceful shutdown

On SIGTERM: stop accepting new work, finish or hand back in-flight requests and messages
within the platform's grace period, close pools, then exit. Readiness probes turn false first
so the load balancer stops routing new traffic.
