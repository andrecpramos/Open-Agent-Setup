# Delegation — the team, the brief you give it, and what you check

Subagents run in their own context: everything they read stays there, and only their report
comes back. That makes them right for **reading and judging** (exploring, planning, reviewing,
running noisy checks) and for **building one step at a time** — never for writing in parallel
with you or with each other. Each runs on its own model tier, so delegating also moves a step
to the model that is worth its price for it. The project's AGENTS.md lists the agents installed
here in its "Who does what" table, and the tiers in "Model tiers".

## The team

| Step | Agent | Tier | Delegate when | Returns |
|---|---|---|---|---|
| Explore | scout | low | more than a handful of files to understand; "where is", "how does", "what uses" | a `file:line` map in the order the flow runs |
| Plan | planner | high (frontier for critical work) | M and L work, before the first edit: the reading stays in its context, the plan comes back | design decisions, steps with files, check and tier, risks, at most two questions |
| Build | implementer | medium | a plan of more than a few edits, when you run above medium — one step per call | DONE or BLOCKED per step, files changed, the check and its result |
| Verify | gate-runner | low | before a commit or PR, or when the full gate output would flood the conversation | MERGE-SAFE or BLOCKED, with the cause of each failure |
| Review | code-reviewer | high | a change across several files or layers, or a risky one, before you report it done | READY or CHANGES NEEDED, ranked findings against the brief |
| Review | security-reviewer | high (frontier where money, auth or data loss is at stake) | auth, sessions, permissions, payments, personal data, uploads, outbound requests, webhooks, LLM tools | findings by severity, each with exploit path and fix |
| Review | architecture-reviewer | high | a new module, dependency, service, queue or datastore; a change that crosses layers | boundary violations counted, ADRs needed, the one most important action |
| Docs | doc-writer | low | the changelog, README and docs for a finished change; one mechanical edit across many files | the files changed, one line each |
| Docs | docs-keeper (admin role) | low | after a structural change (moved modules, renamed commands), before a release | corrections made, questions for the user |

## Routing by tier — when handing off pays

The price of a step is its tokens times its model's rate. The main conversation is usually the
most expensive place to spend tokens: every call re-reads all of it. So:

- **Down** — work that needs care but not judgement (searching, reading check output, typing out
  a decided plan, the changelog) costs a fraction on a lower tier, and keeps its tokens out of
  the main conversation. Hand it down when it is more than a few calls of work.
- **Up** — work whose mistakes are expensive (the plan of an L change, a review of auth or
  money, a bug that survived two attempts) is worth the higher rate. Hand it up when you run
  below its tier.
- **Stay** — XS and S work, and anything smaller than the cold start: a subagent re-reads what
  you already have, and a three-line fix delegated costs more than it saves.
- **Escalate one run** when your tool lets you choose the model for a single subagent call:
  name the next tier's model from AGENTS.md "Model tiers" (frontier for critical plans and
  reviews). If it cannot, do the step yourself when you already run on that tier.

The usage report (`agent-setup usage`, or `node .agents/hooks/session-eval.mjs --usage` where the
session recorder is installed) shows
what each tier cost, what routing saved against running everything on the main model, and
whether checks and corrections held up in the routed sessions — read it before changing a tier.

**No subagents in your tool** (or the agent is not installed)? Do the step yourself, following
the agent's file (`.claude/agents/<name>.md` with Claude Code, `.agents/agents/<name>.md`
otherwise) — the procedure is the same; only the
context isolation is lost, so read narrowly.

## Briefing a subagent

A subagent starts with none of this conversation. Give it everything it needs in one message:

```
Goal: <what you need to know or have checked — one sentence>
Context: <the brief's goal and acceptance line; the branch; the files or diff in scope>
Return: <the shape you want back — e.g. "a file:line map, at most 300 words", "VERDICT + findings">
Limits: read-only; do not run the full test suite; stop when the question is answered.
```

Bad: "Review the code." Good: "Review the uncommitted diff against this brief (goal …,
acceptance …). Focus on the new export endpoint: streaming, error paths, the auth check.
Return VERDICT plus ranked findings with file:line."

The cheaper the tier, the more the brief has to carry — a lower tier follows instructions well
and fills gaps badly:

- **planner**: the whole brief, the scout's map if there is one, and what is already decided.
- **implementer**: one step exactly as the plan wrote it (what, files, check), the acceptance
  line, and the plan around it for context. Never "build the feature".
- **doc-writer**: the diff or its file list, a line on what changed for the people who use it,
  and where the changelog and docs live.

## Parallel or sequential

- **Parallel**: independent reads and reviews — the scout mapping two unrelated areas; the
  code, security and architecture reviewers on the same finished diff. Start them in the same
  turn and wait for all of them.
- **Sequential**: anything that depends on an earlier result — explore, *then* plan; build,
  *then* review; fix the findings, *then* re-run the checks.
- **Never in parallel**: two agents editing files — two implementers, or an implementer while
  you edit. Keep the writing in one place at a time.

## Checking what comes back

A subagent's report is evidence to weigh, not a verdict to forward:

- **Paths and line numbers**: open one or two of them. A map with paths that do not exist was
  guessed.
- **"No issues found"** with no list of what was checked is not a review. Ask what it checked,
  or check the riskiest path yourself.
- **Findings**: reproduce a high one before you act on it (the input it names, the test it
  suggests). A finding you disagree with gets a reason in the report, not silence.
- **Cost**: each agent re-reads files you may already have. Don't send the scout to read the
  one file you already have open.
