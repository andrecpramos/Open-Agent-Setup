# Delegation — the team, the brief you give it, and what you check

Subagents run in their own context: everything they read stays there, and only their report
comes back. That makes them right for **reading and judging** (exploring, reviewing, running
noisy checks) and wrong for **writing** in parallel with you. The project's AGENTS.md lists the
agents installed here in its "Who does what" table.

## The team

| Step | Agent | Delegate when | Returns |
|---|---|---|---|
| Explore | scout | more than a handful of files to understand; "where is", "how does", "what uses" | a `file:line` map in the order the flow runs |
| Review | code-reviewer | a change across several files or layers, or a risky one, before you report it done | READY or CHANGES NEEDED, ranked findings against the brief |
| Review | security-reviewer | auth, sessions, permissions, payments, personal data, uploads, outbound requests, webhooks, LLM tools | findings by severity, each with exploit path and fix |
| Review | architecture-reviewer | a new module, dependency, service, queue or datastore; a change that crosses layers | boundary violations counted, ADRs needed, the one most important action |
| Verify | gate-runner | before a commit or PR, or when the full gate output would flood the conversation | MERGE-SAFE or BLOCKED, with the cause of each failure |
| Docs | docs-keeper (admin role) | after a structural change (moved modules, renamed commands), before a release | corrections made, questions for the user |

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

## Parallel or sequential

- **Parallel**: independent reads and reviews — the scout mapping two unrelated areas; the
  code, security and architecture reviewers on the same finished diff. Start them in the same
  turn and wait for all of them.
- **Sequential**: anything that depends on an earlier result — explore, *then* plan; build,
  *then* review; fix the findings, *then* re-run the checks.
- **Never in parallel**: two agents editing files. Keep the writing in one place.

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
