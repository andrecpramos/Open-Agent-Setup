---
name: security
description: >
  Find, fix and prevent security vulnerabilities — review a diff, PR or feature for broken
  access control (IDOR/BOLA), injection, XSS (dangerouslySetInnerHTML, v-html), CSRF, SSRF,
  authentication, session and JWT flaws, token storage, password hashing, exposed secrets,
  weak crypto, unsafe file handling, dependency risk (npm audit, a CVE in a transitive
  dependency), and LLM prompt injection; threat-model a design; harden configuration. Use
  whenever code handles user input, login, sessions, tokens, passwords, permissions, payments,
  personal data (GDPR), file uploads, outbound URL fetches or secrets, and whenever someone
  asks "is this safe?", "could this be exploited?" or for a security review — even a quick
  question, even mid-feature. Load it for a PR or branch review too: it carries the checklists
  and this project's overlay, which a generic review command lacks.
---

# Security

A security review is not a checklist pass. It is following untrusted data from the moment it
enters to every place it can do damage, and checking each door on the way. Most real
vulnerabilities are not exotic — they are a missing ownership check, a string-built query, a
bypassed sanitiser — so the method matters more than the catalogue.

Two modes: **review** (something exists — find what is exploitable) and **build** (something
is being designed or written — make the secure path the default).

## Before you start

1. **Read the overlay.** `.agents/overlays/security.md`, if it exists, is this project's
   adaptation of this skill and wins where they disagree.
2. **Read the project's threat model** if there is one — `.agents/docs/security.md`: assets,
   trust boundaries, review triggers, accepted risks. It defines what is in scope here.
3. **Find the security primitives the project already has**: auth middleware, a policy or
   permission helper, the validation library, the query builder/ORM, an HTML sanitiser, CSRF
   protection, a rate limiter, the secret store. The most common correct fix is "use the
   primitive this code bypassed".

## Review mode

1. **List the entry points in scope** — routes, resolvers, RPC methods, message consumers,
   webhooks, file and document parsers, CLI arguments, scheduled jobs that read external data,
   and tools an LLM can call.
2. **For each entry point, answer with evidence (file:line):**
   - **Who can reach it?** Authenticated, or deliberately public?
   - **Which objects does it act on, and is ownership or tenancy checked for each one?**
     Missing object-level authorisation is the most common serious bug in real applications.
   - **Which inputs does it read, and are they validated** — type, size, format, allow-list —
     before use?
   - **Where does each input end up?** Trace it to the sinks: SQL/NoSQL queries, shell
     commands, filesystem paths, HTML and templates, redirects, server-side HTTP requests,
     deserialisers, `eval`/template engines, logs, and LLM prompts with tool access.
   - **What does it reveal?** Error details, timing differences, extra response fields,
     whether an account or record exists.
3. **Check secrets and configuration** the change touches, and **new dependencies** — known
   vulnerabilities, typosquats, install scripts, maintenance, licence.
4. **Report** in the format below. Only findings with a concrete path to exploitation; mark
   confidence; no speculative noise. A report with thirty "consider" items hides the one
   critical.

Detection patterns and grep recipes for each class, per language:
[references/vulnerability-catalog.md](references/vulnerability-catalog.md).

## Build mode

1. **Threat-model the feature in ten minutes** — assets, actors, trust boundaries, what could
   go wrong at each crossing, and the mitigation for each with where it is enforced.
   [references/threat-modeling.md](references/threat-modeling.md)
2. **Make the secure path the default:** deny by default; schema-validate input at the
   boundary; parameterised queries only; rely on the framework's output encoding and never
   bypass it; authentication through the framework's vetted mechanism; authorisation as a
   policy check on every object access; secrets from the secret store; least privilege for
   tokens, database users and cloud roles; secure headers and cookie flags; fail closed.
   Concrete settings: [references/secure-defaults.md](references/secure-defaults.md)
3. **Write the negative tests first:** another user's id returns 404/403, a missing token
   returns 401, oversized or malformed input returns 4xx, the injection payload is inert.
4. **LLM or agent features** get their own threat model — prompt injection is an
   architecture problem, not a prompting problem:
   [references/llm-security.md](references/llm-security.md)

## What to look for — the short list

| Class | What it looks like in code |
|---|---|
| Broken access control | Record loaded by an id from the request with no owner/tenant condition; role checks only in the UI; mass assignment of the request body; nested fields (GraphQL, includes) returning objects the caller may not see |
| Injection | Queries, shell commands or templates built by string interpolation; NoSQL operators accepted from JSON (`{"$ne": null}`); `shell=True`/`exec` with input |
| XSS | `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `{@html}`, `|safe`, `bypassSecurityTrust…` with user-influenced data; `javascript:` URLs; unsanitised Markdown; SVG uploads served inline |
| CSRF | Cookie-authenticated state changes without SameSite + token; state-changing GETs; CORS reflecting any origin with credentials |
| SSRF | The server fetches a URL that came from input (importers, previews, webhooks, PDF renderers) without an allow-list and private-range blocking |
| Authentication and sessions | Weak or fast password hashing; JWTs not fully verified (alg, signature, exp, iss, aud); no rotation on login; no rate limit on login/reset/OTP; account enumeration; reset tokens that are reusable or long-lived |
| Crypto and randomness | Home-made crypto; ECB; nonce reuse; `Math.random`/`random` for tokens; `==` on secrets; TLS verification disabled |
| Secrets | In code, committed config, logs, error messages, client bundles, CI output, git history |
| Files | Type trusted from the extension or `Content-Type`; no size limit; user filenames in paths; archives extracted without path checks; uploads served from the app's origin |
| Deserialisation | `pickle`, Java native serialisation, unsafe YAML load, `unserialize` on untrusted data; deep-merge prototype pollution |
| Misconfiguration | Debug mode, verbose errors, default credentials, permissive CORS, missing security headers, public buckets, exposed admin panels |
| Supply chain | No lockfile, unpinned CI actions, install scripts, typosquats, dependency confusion, broad CI tokens, `curl … \| sh` |
| Failing open | `catch` blocks that allow; partial failures that leave auth state inconsistent; "if the check errors, continue" |
| Privacy | Personal data in logs, analytics, URLs or error trackers; no erasure path; over-collection |
| LLM features | Prompt injection through retrieved content; tools with more power than the task needs; model output used in queries, shell or HTML unvalidated; exfiltration via rendered links and images |

## Report format

```markdown
## Security review — <scope> — <date>
N findings: critical a · high b · medium c · low d. <One sentence on overall posture.>

### [HIGH] Invoice download returns other tenants' invoices (IDOR)
- **Where:** src/api/invoices/download.ts:42
- **Exploit:** an authenticated user of tenant A requests /invoices/<id of tenant B's invoice>;
  the handler loads by id alone and returns it.
- **Impact:** cross-tenant disclosure of names, addresses and amounts.
- **Fix:** scope the lookup to the caller's tenant (`where: { id, tenantId: auth.tenantId }`)
  and return 404 otherwise; add a test proving tenant A gets 404 for tenant B's invoice.
- **Confidence:** high — traced from route to query.
```

Severity is impact × exploitability. **Critical**: unauthenticated remote code execution, auth
bypass, bulk data exposure. **High**: authenticated cross-user or cross-tenant access, stored
XSS reaching privileged users, SSRF into internal services or cloud metadata. **Medium**:
CSRF on meaningful actions, limited information leaks, missing rate limits on sensitive
endpoints. **Low**: hardening and defence in depth.

## Tools — use what is installed, never install silently

Secrets: `gitleaks detect` (history too), `trufflehog`. Static analysis: `semgrep --config
auto`, CodeQL, `bandit`, `gosec`, `brakeman`. Dependencies: `npm/pnpm/yarn audit`,
`pip-audit`, `osv-scanner`, `govulncheck`, `cargo audit`, `dotnet list package --vulnerable`.
Containers and IaC: `trivy`, `checkov`. Tools produce candidates; confirm exploitability
before reporting.

## What not to do

- Don't write exploits against systems you do not own. A failing test against the local code
  is the proof of concept.
- Don't weaken a control to make something work — disabling CSRF protection or TLS
  verification, `CORS: *`, auth-bypass flags. Report the conflict instead.
- Don't paste real secrets into reports, commits or chat; refer to them by name and location,
  and recommend rotation for anything that was exposed.

## Done means

- **Review:** every in-scope entry point is listed with a verdict; findings use the format
  above; each critical or high has a reproduction (test or exact steps) and a fix.
- **Build:** the threat-model notes exist with each mitigation mapped to where it is enforced
  (test, middleware, configuration); negative security tests are in the suite.
- `.agents/docs/security.md` is updated if a trust boundary, asset, review trigger or accepted
  risk changed.

A security lesson this repo taught — a primitive to always use, a boundary that is easy to
miss — belongs in `.agents/learnings/inbox.md`; the retro will usually push it into a gate.
