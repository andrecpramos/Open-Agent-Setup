# HTTP API reference

## Contents

1. Status codes
2. Error format (RFC 9457)
3. Pagination
4. Filtering and sorting
5. Idempotency keys
6. Concurrency control
7. Rate limiting
8. Versioning and deprecation
9. Naming and shape
10. Caching headers

## 1 · Status codes

| Code | Use for | Common misuse |
|---|---|---|
| 200 OK | successful read, or update returning the resource | errors wrapped in a 200 body |
| 201 Created | resource created; include `Location` | 200 for creates |
| 202 Accepted | accepted for async processing; return a status URL | pretending async work finished |
| 204 No Content | success with no body (DELETE, some PUTs) | 204 with a body |
| 400 Bad Request | malformed syntax, unparseable body, invalid query params | — |
| 401 Unauthorized | no or invalid authentication; send `WWW-Authenticate` | used for "not allowed" |
| 403 Forbidden | authenticated but not allowed | leaking existence — use 404 when the caller must not learn it exists |
| 404 Not Found | no such resource *for this caller* | — |
| 405 Method Not Allowed | method not supported; send `Allow` | — |
| 409 Conflict | state conflict — duplicate unique key, invalid state transition | 400 for conflicts |
| 412 Precondition Failed | `If-Match` ETag mismatch | — |
| 413 Content Too Large | body over limit | 500 when the parser chokes |
| 415 Unsupported Media Type | wrong `Content-Type` | — |
| 422 Unprocessable Content | well-formed but semantically invalid (field validation) | — (400 is also acceptable if the API uses it consistently) |
| 429 Too Many Requests | rate limited; send `Retry-After` | 503 for rate limits |
| 500 Internal Server Error | unexpected server failure | validation errors |
| 502 / 503 / 504 | upstream failure / unavailable (+`Retry-After`) / upstream timeout | — |

## 2 · Error format

Default to RFC 9457 Problem Details (`application/problem+json`) unless the API already has
a format — then use that one everywhere.

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Your request is not valid.",
  "status": 422,
  "detail": "2 fields failed validation.",
  "instance": "/orders/9f1c…",
  "code": "VALIDATION_FAILED",
  "errors": [
    { "pointer": "/items/0/quantity", "code": "min", "message": "must be at least 1" },
    { "pointer": "/email", "code": "taken", "message": "is already registered" }
  ],
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

- A stable, machine-readable `code` (or `type`) per error kind — clients switch on it; they
  must never parse `detail`.
- Field errors point at the field (JSON Pointer) so UIs can put the message next to the input.
- A `traceId` lets support find the request. Never a stack trace, SQL or internal hostname.
- One global error handler maps exceptions to responses; handlers don't format errors ad hoc.

## 3 · Pagination

**Cursor/keyset** (default for anything large or changing):

```
GET /orders?limit=50&cursor=eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTAxVDEyOjAwOjAwWiIsImlkIjoiOWYxYyJ9
→ { "data": [ … ], "page": { "nextCursor": "…", "hasMore": true } }
```

- Cursors are opaque (base64 of the sort key + id), never raw offsets the client edits.
- Deterministic order with a tie-breaker (`created_at DESC, id DESC`).
- Server-side cap on `limit` (e.g. max 100), with a default.
- **Offset** (`page`/`pageSize`) only for small, stable datasets or when users must jump to a
  page number. Totals are expensive; include them only if the product needs them.

## 4 · Filtering and sorting

- Allow-list filterable and sortable fields; reject unknown ones with 400. Never pass a
  client-supplied field name or operator into a query builder unchecked.
- Consistent syntax across the API (`?status=paid&createdAfter=…` or a documented filter
  grammar), with indexes supporting the combinations you allow.

## 5 · Idempotency keys

For POST (and PATCH) operations with side effects that a client may retry:

1. Client sends `Idempotency-Key: <uuid>` (one per logical operation, reused on retry).
2. Server stores `(key, principal, request fingerprint) → response` under a unique constraint,
   with a retention period (e.g. 24 h).
3. Same key + same fingerprint → return the stored response (same status and body).
4. Same key + different fingerprint → 422 (or 409): key reuse with a different payload.
5. Same key while the first request is still processing → 409 so the client retries later.

## 6 · Concurrency control

- Return an `ETag` (version or hash) on reads; require `If-Match` on updates of contended
  resources; respond 412 on mismatch, and 428 Precondition Required if the header is missing
  and it is mandatory.
- Alternatively a `version` field in the body checked with an optimistic lock.

## 7 · Rate limiting

- Limit per principal (and per IP for unauthenticated endpoints such as login, signup,
  password reset), tighter on expensive or abuse-prone operations.
- 429 with `Retry-After`; optionally `RateLimit-*` headers.
- Rate-limit before doing expensive work (and before authentication for credential-stuffing
  targets).

## 8 · Versioning and deprecation

- Prefer evolving without versions: additive changes only, tolerant readers.
- When a breaking change is unavoidable: a new version (URL `/v2`, a header, or a media type —
  whatever the API already uses) running alongside the old one.
- Deprecate with notice: `Deprecation` and `Sunset` headers, a changelog entry, usage
  monitoring on the old version, and a removal date agreed with the user.

## 9 · Naming and shape

Follow the API's existing conventions. Absent any: plural nouns for collections
(`/orders`, `/orders/{id}`), sub-resources for ownership (`/orders/{id}/items`), verbs only
for genuine actions that are not CRUD (`POST /orders/{id}/cancel`), one casing throughout
(camelCase or snake_case), ISO 8601 timestamps with an offset, money as `{ "amount": "12.50",
"currency": "EUR" }` or integer minor units, never floats.

## 10 · Caching headers

- `Cache-Control: no-store` on anything personal or sensitive.
- Public, cacheable reads: `Cache-Control: public, max-age=…` plus `ETag` for conditional
  requests (304).
- Never let a shared cache (CDN, proxy) cache a personalised response — check `Vary` and
  `private`.
