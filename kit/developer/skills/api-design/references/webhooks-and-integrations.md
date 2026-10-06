# Webhooks and third-party integrations

## Wrapping a third-party API

Put every external API behind an adapter (port) you own:

```
domain / use case ──calls──▶ PaymentGateway (your interface, your types)
                                   ▲
                      StripePaymentGateway (the only file that imports the Stripe SDK)
```

The adapter is responsible for:

- **Timeouts** on every call, retries only for transient failures and idempotent operations
  (use the vendor's idempotency keys where offered).
- **Mapping errors** into your own error types — "card declined" is a domain outcome, "Stripe
  returned 500" is a dependency failure; callers should never see vendor exception classes.
- **Mapping data** into your own types; vendor field names and enums do not leak inward.
- **Credentials** from configuration/secret storage, never hardcoded; least-privilege keys.
- **Observability** — log the call, latency and outcome (without secrets or personal data).
- **Testability** — a fake implementation for unit tests, and recorded/replayed fixtures or a
  sandbox account for adapter tests. Tests never hit the real vendor from CI unless the project
  has a deliberate sandbox suite.

Also decide explicitly: what the product does when the vendor is down (queue and retry
later? degrade? fail visibly?) — and write that path first.

## Receiving webhooks

1. **Verify the signature** over the **raw** request body (before JSON parsing, which may
   reorder or normalise it), using the provider's scheme and a constant-time comparison.
   Reject missing or invalid signatures with 400/401.
2. **Check the timestamp** in the signed payload and reject old deliveries (replay window,
   e.g. 5 minutes).
3. **Respond fast** (2xx within the provider's timeout): persist the event, then process
   asynchronously.
4. **Deduplicate** by the provider's event id (unique constraint) — providers retry, and
   deliver out of order.
5. **Don't trust the payload for state that matters** — for high-stakes events (payment
   succeeded), re-fetch the object from the provider's API by id before acting.
6. Allow-list event types you handle; log and ignore the rest.

## Sending webhooks

- Sign each delivery (HMAC-SHA256 over `timestamp.body`, secret per subscriber), and send the
  timestamp and signature in headers; document verification for your consumers.
- Include a unique event id and event type; keep payloads thin (ids + minimal data) or
  versioned.
- Retry with exponential backoff over hours; disable endpoints that fail persistently and
  notify their owner.
- Protect against SSRF: validate subscriber URLs (https only, no private/internal address
  ranges, re-check the resolved IP at send time), and don't follow redirects blindly.
- Provide a way to replay missed events.

## Backends-for-frontends and gateways

- A BFF shapes data for one client; it may aggregate and trim, but business rules stay in the
  services behind it.
- Forward the caller's identity (a token or signed context) rather than letting the BFF act
  with a superuser credential.
- Propagate correlation ids and deadlines through the gateway/BFF to every downstream call.
