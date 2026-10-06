# Protocol notes

## GraphQL

- **Nullability is a contract.** Output fields nullable by default is the resilient choice
  (one failing resolver nulls a field instead of the whole response); make fields non-null
  only when they truly can never fail. Inputs: required arguments non-null.
- **N+1 queries** — a resolver per item that queries the database. Batch with DataLoader (or
  the server's equivalent) per request.
- **Limits** — query depth, complexity/cost analysis, and pagination on every list field
  (Relay connections or an explicit `first`/`after`). Disable introspection in production if
  the schema is private; consider persisted queries for public clients.
- **Authorisation** in the resolver or a policy layer for every object type — not only at the
  top-level query, or nested fields leak data (`order { customer { email } }`).
- **Errors** — expected domain outcomes as typed results (`union PlaceOrderResult = Order |
  OutOfStock`) rather than exceptions; unexpected failures in `errors` with an extension code.
- **Mutations** return the changed object (and any affected ones) so clients can update caches.

## gRPC / Protobuf

- Field numbers are forever: never reuse, `reserved` removed ones.
- Every call sets a **deadline**; servers honour cancellation.
- Map errors to canonical status codes (`INVALID_ARGUMENT`, `NOT_FOUND`, `ALREADY_EXISTS`,
  `FAILED_PRECONDITION`, `PERMISSION_DENIED`, `UNAUTHENTICATED`, `RESOURCE_EXHAUSTED`,
  `UNAVAILABLE`) and use rich error details for field violations.
- Enums start with `*_UNSPECIFIED = 0`.
- Use `buf` (or the project's tool) for lint and breaking-change detection in CI.

## tRPC

- Inputs validated with the router's schema (zod/valibot) — tRPC procedures are public HTTP
  endpoints; type safety at compile time is not validation at run time.
- Authorisation in middleware (`protectedProcedure`) **and** per-object checks inside the
  procedure.
- Breaking changes are compile errors only for clients built from the same repo; mobile apps
  or external consumers still need a compatibility plan.

## REST + OpenAPI

- Spec-first or code-first, but one source of truth: generate the spec from annotations, or
  the server stubs/clients from the spec — not both hand-written.
- Lint the spec (Spectral or Redocly) and check breaking changes in CI (oasdiff or
  openapi-diff) against the main branch.
- Generated client types checked into the repo need a drift check in CI (regenerate and
  `git diff --exit-code`).

## Server-Sent Events and WebSockets

- Authenticate the connection (token on connect, re-validated on expiry); authorise each
  subscription/channel.
- Heartbeats, reconnection with backoff, and resume from the last event id.
- Bound messages per connection and connections per principal; treat every inbound message as
  untrusted input.
