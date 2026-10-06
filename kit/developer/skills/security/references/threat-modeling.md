# Threat modelling in ten minutes

Four questions, answered briefly and in writing. The value is in naming trust boundaries and
mapping each mitigation to where it is enforced — not in the diagram's polish.

## 1 · What are we building?

List, in a few lines:

- **Actors** — anonymous visitor, customer, customer of another tenant, admin, support staff,
  partner system, scheduled job, the LLM (if any).
- **Assets** — what an attacker wants: personal data, credentials and tokens, money movement,
  admin capability, availability, the model's tools.
- **Data flows and stores** — client → API → service → database/queue/third party.
- **Trust boundaries** — every point where data crosses from something you do not control
  into something you do: browser → server, partner webhook → handler, uploaded file → parser,
  retrieved document → prompt, one tenant's data → a shared cache.

A small ASCII sketch is enough:

```
[Browser] ──HTTPS──▶ [API] ──▶ [Orders svc] ──▶ (Postgres)
                       │  ╎ boundary: untrusted input
[Stripe] ──webhook──▶ [Webhook handler] ──▶ [Queue]
```

## 2 · What can go wrong?

At each boundary crossing, walk STRIDE:

| | Threat | Question |
|---|---|---|
| S | Spoofing | Can someone pretend to be another user or system? |
| T | Tampering | Can data be modified in transit, at rest, or by the client? |
| R | Repudiation | Could someone deny an action we can't prove? |
| I | Information disclosure | Can data leak — to another tenant, in errors, in logs? |
| D | Denial of service | Can one caller exhaust something shared? |
| E | Elevation of privilege | Can someone do what their role should not allow? |

Add the application-specific ones: business-logic abuse (negative quantities, coupon
stacking, race conditions on balances), and for LLM features, prompt injection and excessive
agency.

## 3 · What are we going to do about it?

| Threat | Mitigation | Enforced by | Status |
|---|---|---|---|
| Tenant A reads tenant B's orders | tenant from session in every query; repository requires tenant | `orders.repository.ts` + test `orders.tenancy.test.ts` | mitigated |
| Webhook forgery | HMAC signature over raw body, 5-min replay window | `webhooks/verify.ts` + test | mitigated |
| Brute force on login | 5 attempts / 15 min per account + IP | rate-limit middleware config | mitigated |
| Admin action repudiation | audit log with actor, action, target, timestamp | — | **open** |

Every mitigation names a **runnable thing** — a test, middleware, a config value, a gate.
"Code review" is not enforcement. Accepted risks name an owner and a date.

## 4 · Did we do a good job?

- Is every boundary from step 1 covered by at least one row?
- Does every "mitigated" row have a test that would fail if the mitigation were removed?
- Are the open rows in the project's gap list (`.agents/docs/critical-infrastructure.md` or
  `security.md`)?

Record the result in `.agents/docs/security.md` (threat table, trust boundaries, review
triggers) when it changes the project's picture; otherwise in the PR description.
