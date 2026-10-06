---
name: api-design
description: >
  Design, change, review or consume the middle layer between clients and services — REST/HTTP,
  GraphQL, gRPC and tRPC contracts, OpenAPI specs, BFFs, API gateways and middleware, webhooks,
  generated clients/SDKs and third-party integrations. Use whenever adding or changing an
  endpoint, request/response shape, status code, error format, pagination, filtering,
  versioning, auth header, rate limit, idempotency key or webhook; when wrapping a vendor API;
  or when frontend and backend disagree ("types out of sync", "breaking change", "the API
  returns 500 for bad input"). Not for the persistence and business logic behind an endpoint
  (backend) or for vulnerability review (security).
---

# API and integration design

An API is a promise to code you don't control. Every field, status code and error message is
depended on by someone the moment it ships, so the design work happens before the first
consumer exists — and after that, the job is changing it without breaking anyone.

## Before you start

1. **Read the overlay.** `.agents/overlays/api-design.md`, if it exists, is this project's
   adaptation of this skill and wins where they disagree.
2. **Find the existing conventions and follow them over any "best practice" here**: URL and
   field naming, casing, envelope shape, error format, pagination style, auth scheme,
   versioning. Consistency across one API beats local perfection in one endpoint.
3. **Find the source of truth for the contract** — an OpenAPI/AsyncAPI file, GraphQL SDL,
   `.proto` files, tRPC router types, or annotations that generate them — and whether clients
   are generated from it. If types are generated, change the source, regenerate, and commit
   both; never hand-edit generated clients.

## Workflow

1. **Contract first.** Write or change the spec/schema before the handler: resources and
   operations, request and response shapes, status codes, errors, auth. Review the contract
   as the product.
2. **Classify the change** — additive, or breaking for any existing consumer? Use
   [references/breaking-changes.md](references/breaking-changes.md). A breaking change needs a
   new version or a deprecation window, and the user's decision — never a silent edit.
3. **Validate at the boundary.** Parse every input (body, query, path, headers) against a
   schema at the edge, reject with a precise 400/422, and hand typed values inward. Limit sizes:
   body bytes, array lengths, string lengths, page sizes.
4. **Authenticate at the edge, authorise per object.** Middleware proves who the caller is;
   the handler or policy layer proves they may act on *this* record (see `security`).
5. **Design the unhappy paths:** errors in the project's format (default: RFC 9457 problem
   details), idempotency for retried writes, concurrency control for updates, rate limits.
   [references/http-reference.md](references/http-reference.md)
6. **Keep both sides in lockstep:** regenerate clients/types, add a contract test or a drift
   check in CI, update the docs and changelog.

## The mistakes that matter

- **Silent breaking changes.** Renaming or removing a field, making an optional request field
  required, changing a type or format, changing the meaning of a status code, or adding an
  enum value that strict clients reject. Mobile apps and third parties cannot be redeployed
  with you.
- **200 for errors, 500 for bad input.** A client error is 4xx with a machine-readable
  reason; 5xx means the server failed. Unvalidated input that reaches a database or parser
  and explodes is a 500 that should have been a 400 — and often a security bug.
- **Leaking internals** in errors or payloads: stack traces, SQL, ORM entity shapes, internal
  ids, other users' data in nested objects. Response DTOs are designed, not serialised
  entities.
- **Trusting identifiers from the client** — a `userId` or `tenantId` in the body used as-is.
  Derive identity from the authenticated principal; check object ownership on every access.
- **Mass assignment** — binding the whole request body onto a model, so `isAdmin` or
  `priceCents` can be set by the caller. Map explicit allowed fields.
- **Non-idempotent retries.** A POST that creates or charges, retried after a timeout, runs
  twice. Accept an `Idempotency-Key` for anything with side effects a client may retry.
- **Unbounded collections** — no pagination, no maximum page size, no limit on filters or
  `include`/`expand` depth, GraphQL without depth/complexity limits.
- **Lost updates.** Two clients edit the same resource; the last write wins silently. Use
  ETags with `If-Match` (412 on mismatch) or a version field.
- **Chatty integration code** — vendor SDK types and error shapes spread through the domain.
  Wrap every third-party API behind an adapter you own, with timeouts, retries, mapped
  errors and recorded fixtures for tests. [references/webhooks-and-integrations.md](references/webhooks-and-integrations.md)
- **Unverified webhooks** — accepting inbound webhooks without checking the signature
  against the raw body, or processing them synchronously and non-idempotently.
- **Business logic in middleware.** Middleware is for cross-cutting concerns — auth,
  correlation ids, rate limiting, compression, logging. Order matters: rate-limit before
  expensive work, authenticate before parsing large bodies where possible.
- **Client/server type drift** — hand-maintained types on both sides that diverge. Generate
  one from the other, and gate it in CI.

## Checklist for a new or changed operation

- [ ] Method and path follow the API's conventions; the operation is idempotent where HTTP
      says it should be (GET, PUT, DELETE).
- [ ] Request schema validated with size limits; unknown fields handled deliberately.
- [ ] AuthN required (or explicitly public); object-level authorisation checked.
- [ ] Responses: success shape, every error status, in the project's error format.
- [ ] Collections paginated with a server-side cap; filters and sorts allow-listed.
- [ ] Writes that may be retried accept an idempotency key; updates have concurrency control.
- [ ] Rate limits and timeouts considered for expensive or externally triggered operations.
- [ ] Spec updated, clients regenerated, contract/drift check passes, docs and changelog updated.
- [ ] Breaking? Then versioned or deprecated with a sunset date — and the user agreed.

## Protocol notes

GraphQL, gRPC and tRPC specifics — nullability, N+1 with dataloaders, field-number rules,
deadlines, error mapping: [references/protocols.md](references/protocols.md).

## Done means

- The contract artefact (spec/SDL/proto/router types) is updated in the same change as the
  implementation, and generated clients are regenerated.
- Tests cover success, validation failure, auth failure (401 and 403), not found, and conflict
  for the operation — plus a contract or schema test if the project has that layer.
- Breaking changes are either absent or explicitly approved, versioned and documented.

When a contract convention in this repo surprised you, capture it in
`.agents/learnings/inbox.md` for the overlay.
