# The brief — examples and sizing

The brief is the request rewritten so that two people would build the same thing from it. It
is short on purpose: the user reads it in ten seconds and corrects it in one line.

## Weak request → brief

**"make the dashboard faster"**

```
Goal: the dashboard's first load feels instant on a normal connection.
Scope: in — the dashboard route and the three queries it runs · out — other pages, the API's public contract.
Acceptance: dashboard API p95 under 300 ms in the existing load test, and the page's largest contentful paint under 2.5 s on the throttled profile.
Assumptions: "faster" means the first load, not interactions; the slow part is the queries (to be confirmed by a profile before any change).
Risks: caching stale balances — needs an invalidation rule.
```

**"the signup form is broken"**

```
Goal: a new user can sign up with a valid email and password.
Scope: in — the signup form and its submit handler · out — login, password reset.
Acceptance: a test that submits the form with valid data and lands on the welcome page; the failure the user saw reproduced first.
Assumptions: "broken" = the submit button does nothing (seen in the console: a 422 with no message shown); asking only if that is not it.
Risks: none.
```

**"add CSV export to reports" (already a decent request)**

```
Goal: users download the current report as a CSV.
Scope: in — the reports page and a new export endpoint · out — PDF, scheduled exports.
Acceptance: an endpoint test for the CSV body and headers (Content-Disposition), and the button downloads the file in the browser.
Assumptions: the export uses the same filters as the screen; dates in ISO 8601.
Risks: large reports — stream the response instead of building it in memory.
```

## Sizing

| Size | Looks like | Plan | Review | Report |
|---|---|---|---|---|
| XS | one line in one file; a typo, a constant, a log message | none | none | one line: what changed and the check that ran |
| S | one area, a few files, no new concepts | the steps in your head, the test named in the brief | code-reviewer when it changes behaviour | the standard report |
| M | a feature across layers (UI + API + data), a refactor of a module | written steps, the failing test first | code-reviewer, plus security/architecture when they apply | the standard report |
| L | cross-cutting, a migration, a new service, money or auth flows, more than a day | written plan, **approved before editing**; checkpoints between phases | every reviewer that applies, per phase | per phase, and a handoff between sessions |

A request that turns out bigger than its size mid-way (an S that needs a migration) is re-sized
out loud: say so, re-plan, and ask before carrying on if it became L.

## When to ask, and when to assume

Ask — at most two questions — when a wrong guess is expensive to undo:

- the shape of data that will be stored, or of a public API others will call;
- a destructive or irreversible step (deleting data, rewriting history, changing production);
- a choice between two reasonable products ("should a deleted user's invoices stay visible?").

Assume, and say so in the brief, when the guess is cheap to change: naming, layout details,
which of two equivalent libraries the codebase already uses (use the one it uses), the order of
fields in a form.
