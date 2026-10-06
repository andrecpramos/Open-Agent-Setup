# Learnings

The inbox for lessons this project teaches its agents. Processed by the `self-improve` skill.
The format matters: a hook counts the entries and the retro parses them.

## Adding an entry — any agent, any time

Append to `inbox.md`:

```markdown
## YYYY-MM-DD — <the lesson as a short imperative>
- **What happened:** one or two sentences — the mistake, or the surprise.
- **Lesson:** the rule a future session should follow, stated so a violation is recognisable.
- **Evidence:** file:line, command, error text, or the user's own words.
- **Scope:** project | universal | personal — your best guess.
- **Skill:** the kit skill it relates to (`frontend`, `security`, …) or `none`.
```

Five lines at most. No secrets and no personal data. They are committed with the repo. A
"remember" or "from now on" from the user goes in the same way, with **Standing rule** in the
title, and is followed for the rest of the session.

## What happens to it

Capturing is everyone's; routing is the admin's. Whoever maintains the setup runs
`/self-improve retro` — or follows `.agents/skills/self-improve/SKILL.md` by hand — which
routes each entry to the strongest place that will make it stick: a guard rule or gate, a
`postEdit` check, a skill overlay, a path-scoped rule, or `.agents/docs/lessons.md`. Lessons
true in *any* project become proposals for the Agent_Setup kit. `agent-setup report` says when
entries are waiting or a retro is due. The routing rules live in that skill, not here, so there
is one version of them.

| In this folder | Is |
|---|---|
| `inbox.md` | lessons waiting for a retro |
| `archive/` | processed entries, each with where it was routed |
| `outbox/` | kit proposals, until `agent-setup harvest` collects them |
| `signals.jsonl` | the hooks' friction log — local only, gitignored |
| `eval-windows.jsonl` | one row of facts per context window, from the `session-eval` hook — local only, gitignored |
