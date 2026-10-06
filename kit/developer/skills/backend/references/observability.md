# Observability

The test of observability: when this code misbehaves in production at 3 a.m., can someone
who has never read it find out *what* happened to *which* request, from the telemetry alone?

## Structured logs

Log as structured events (JSON or the platform's structured format), through the project's
logger — never `console.log`/`print` in server code that has a logger.

Fields worth having on every event: `timestamp`, `level`, `message`, `service`, `env`,
`trace_id`/`correlation_id`, `operation`, and where relevant `tenant_id`/`user_id` (opaque
ids), `duration_ms`, `outcome`, `error.type`, `error.message`, `error.stack`.

What to log:

- **Decisions** the code makes that explain later behaviour ("coupon rejected: expired").
- **Failures**, once, at the level that handles them, with the context needed to reproduce.
- **Calls to external systems** — target, outcome, latency.
- **State transitions** of important entities (order placed → paid → shipped).

What never to log: passwords, tokens, API keys, session ids, full card numbers, secrets in
URLs or headers, health data, full names/emails/phone numbers/addresses (log an id instead),
whole request or response bodies from untrusted sources. A log redactor is a backstop, not a
licence.

Levels: `error` — someone should look; `warn` — degraded but handled; `info` — business
events and lifecycle; `debug` — off in production by default. An error logged at `info` is
never seen; an expected condition logged at `error` trains people to ignore errors.

Log once. Logging and rethrowing at every layer produces five copies of one failure.

## Correlation

Accept an incoming trace/correlation id (W3C `traceparent`, or the project's header),
generate one if absent, attach it to every log line (logger context/MDC), pass it on every
outgoing call and message, and return it to clients in error responses so support can find
the trace.

## Metrics

- Services: **RED** — Rate, Errors, Duration (histograms, not averages) per endpoint/operation.
- Resources: **USE** — Utilisation, Saturation, Errors (pools, queues, CPU, memory).
- Business: the few numbers that tell you the product works (orders placed, signups completed).
- Watch label cardinality: user ids, emails or raw URLs as metric labels can take down the
  metrics backend.

## Tracing

OpenTelemetry (or the project's APM) spans around inbound requests, outbound calls, queue
publish/consume and expensive internal steps; propagate context through queues via message
headers.

## Health checks

- **Liveness** — the process is alive and not deadlocked. Never check dependencies here, or a
  database outage restarts every pod in a loop.
- **Readiness** — the instance can serve: dependencies reachable, warm-up done.

## Alerts

Alert on symptoms users feel — error rate, latency against the SLO, queue age, a job that
stopped running — with a runbook link. Every alert should require a human action; an alert
that is routinely ignored should be fixed or deleted.
