# Backend testing

## Levels, by what they may be wrong about

| Level | Real | Fake | Proves |
|---|---|---|---|
| Unit | the function/domain object | nothing needed — pure logic | rules, calculations, state machines |
| Integration | database, queue, cache (containers or ephemeral instances) | third-party HTTP APIs | queries, constraints, transactions, migrations, wiring |
| Contract | the API schema | — | requests/responses match the published contract (OpenAPI/GraphQL schema/protobuf, or consumer-driven Pact) |
| End to end | the deployed stack | external payment/email providers (sandbox) | critical journeys |

## Use the real database for database behaviour

Constraints, transactions, isolation, locking, JSON operators, collation and SQL dialect are
decided by the database engine. Test them against the same engine and major version as
production — Testcontainers, a docker-compose service, or an ephemeral cloud branch. An
in-memory substitute (H2, SQLite for a Postgres app) passes tests that production fails.

Isolation between tests: wrap each test in a transaction rolled back at the end, or truncate
the touched tables; never depend on data left by another test or on test order.

## Cover the failure paths

For each behaviour, at least:

- invalid input → rejected with the right error, nothing written;
- not found → the documented response;
- conflict → the unique/optimistic-lock path, mapped to the domain error;
- dependency failure → timeout/5xx from a faked HTTP dependency (WireMock, nock, MSW, `responses`, `httpx` mocks) produces the designed fallback or error;
- repeat → the same request twice (idempotency key, duplicate message) has one effect.

## Concurrency tests

For anything that must not happen twice (redeeming, reserving, charging), fire N parallel
requests or transactions at it and assert exactly one succeeds. It is the only test that
catches check-then-act races, and it is cheap to write.

## Time, randomness, ids

Inject a clock and id/random generators. Tests that call `now()` break at midnight, on
month boundaries and in other time zones.

## Migrations

CI applies all migrations from scratch to an empty database **and** (where practical) the new
migrations to a copy or fixture of realistic data. A migration tested only on an empty table
has been tested for syntax, not behaviour.

## Fixtures

Builders/factories with sensible defaults (`anOrder().withItems(2).paid()`), created per
test, over one giant shared fixture that every test depends on and nobody can change.
