# Secure defaults

Concrete settings to reach for when building. Where the project or its framework already
sets these, verify rather than duplicate. Values reflect the OWASP cheat sheets as of 2025 —
check current guidance for anything security-critical.

## HTTP response headers

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (add `preload` deliberately) |
| `Content-Security-Policy` | start from `default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, scripts via nonces or hashes, no `unsafe-inline` for scripts |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` (or `no-referrer`) |
| `Permissions-Policy` | disable what you don't use (`camera=(), microphone=(), geolocation=()`) |
| `Cross-Origin-Opener-Policy` | `same-origin` where it doesn't break auth popups |
| `Cache-Control` | `no-store` on authenticated/personal responses |

## Cookies

- Session cookies: `HttpOnly; Secure; SameSite=Lax` (or `Strict`), a `Path=/`, and the
  `__Host-` name prefix (forces Secure, no Domain, Path=/).
- Never store session or refresh tokens in `localStorage`/`sessionStorage`.

## CORS

- Allow-list origins; never reflect arbitrary `Origin` with credentials.
- Limit methods and headers to what is used; short `Access-Control-Max-Age` while iterating.

## Passwords

| Algorithm | Minimum parameters (OWASP Password Storage Cheat Sheet) |
|---|---|
| Argon2id (preferred) | 19 MiB memory, 2 iterations, 1 degree of parallelism |
| scrypt | N = 2^17, r = 8, p = 1 |
| bcrypt | work factor ≥ 10; inputs over 72 bytes are truncated — pre-hash or cap length deliberately |
| PBKDF2 (FIPS contexts) | HMAC-SHA-256, 600,000 iterations |

Plus: minimum length 8 with MFA or 15 without (NIST SP 800-63B guidance), maximum length ≥ 64,
check against breached-password lists, no composition rules, no periodic forced rotation.

## Tokens and sessions

- Random values from a CSPRNG, ≥ 128 bits of entropy (e.g. 32 bytes base64url).
- Store reset, verification and API tokens hashed (SHA-256 is fine for high-entropy tokens).
- Sessions: rotate id on login and privilege change; idle timeout (e.g. 15–30 min for
  sensitive apps) and absolute timeout; invalidate all sessions on password change.
- JWT access tokens: short-lived (minutes), audience-restricted, verified with an explicit
  algorithm; refresh tokens rotated on use with reuse detection.

## Rate limits worth having everywhere

Login, signup, password reset, email/SMS/OTP send and verify, MFA challenge, search and
export endpoints, anything that sends email or costs money.

## Transport

TLS 1.2+ (prefer 1.3); certificate verification always on — including for internal
services and database connections.

## Secrets

- Loaded from the platform's secret store or environment at runtime; never in the repo, the
  image, client bundles or logs.
- One secret per purpose and environment; least privilege; a documented rotation procedure.
- CI: secrets never available to workflows triggered from forks; third-party actions pinned
  to a commit SHA; tokens scoped to the job.

## File uploads

Size limits at the proxy and in the app; type detection by content; generated filenames;
storage outside the web root (object storage with private ACLs and short-lived signed URLs);
image re-encoding; a separate domain for serving user content; malware scanning where
required.

## Dependencies

Lockfile committed and used in CI (`npm ci`, `pnpm install --frozen-lockfile`, `uv sync
--locked`); automated update PRs (Dependabot/Renovate); an audit step in CI with a stated
severity threshold; new dependencies reviewed for maintenance, popularity, install scripts
and licence.

## Logging security events

Log authentication successes and failures, MFA events, permission denials, admin actions,
password and email changes — with actor, target, timestamp and correlation id, and without
secrets or unnecessary personal data. Protect the log store from tampering and set retention.

## Personal data (GDPR baseline)

Collect the minimum; document purpose and retention; support export and erasure (including
backups' retention story and third-party processors); encrypt sensitive categories (health,
biometric) at rest with access logging; keep personal data out of URLs, logs, analytics and
error trackers.
