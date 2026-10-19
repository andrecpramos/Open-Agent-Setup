# Working with the coding agent in this repository

For everyone on the team who works here with Claude Code, Codex, Cursor, Copilot, Gemini CLI or
any other coding agent. One page; the details live in `AGENTS.md` and `.agents/skills/`.

## The one-minute version

1. **Say what you want, where, and how you will know it is done.**
2. **Small fixes just happen**: the agent reads the code, makes the change, runs the check
   that covers it and tells you the result.
3. **Large or risky work starts with a brief** — goal, scope, acceptance — that you can
   correct in one line before anything is changed. Risky means auth, payments, data,
   production or secrets.
4. **Read the report**: what is proven, with evidence, and what could not be checked.
5. **Say "ship it"** when you want a commit and a pull request. Nothing is pushed before that,
   and production only moves when you ask for a release. Where the team runs a pull request per
   task, every change opens its own draft PR as work starts and is merged, branch deleted, when
   its checks are green.

## First time in this repository

- **Nothing to install**, whatever agent you use. Open the repository: Claude Code, Codex,
  Cursor, Copilot, Antigravity and Windsurf read `AGENTS.md` and the skills in `.agents/skills/`,
  and run the hooks this repository set up for them (restart a session that was open when the
  setup landed; Codex asks you to approve the project's hooks once, with `/hooks`).
- Branch protection on the git host covers everyone, whichever agent they use.

## How to ask

```
<what you want> in <where>.
Done when <the test, command or thing you will see>.
Don't touch <what is out of scope>.
```

| Instead of | Try |
|---|---|
| "fix the login" | "Logging in with a correct password says 'invalid credentials' since yesterday's deploy. Fix it in `src/auth/`. Done when the login test passes and I can log in locally. Don't change the session format." |
| "make the table nicer" | "The orders table: sticky header, right-aligned amounts, and an empty state. Only `OrdersTable.tsx` and its styles. Done when it looks right in the browser in light and dark mode." |

- **Questions are fine as questions** — "how does the cache invalidation work?" needs no brief.
- **Want the full cycle on purpose?** `/deliver <idea>` — brief, plan, build, verify, review,
  report.
- **Paste the error**, not a description of it. **Point at an example**: "like the invoices
  page".
- **One task per session.** When it is done: `/handoff` (or `/clear`) and start fresh. Long
  sessions get slower and more expensive with every message.

## What you will see, and what it means

| You see | It means | You do |
|---|---|---|
| a **brief** before any change (Goal · Scope · Acceptance…) | the request was large or risky, so it was restated for you to check | correct it in one line, or carry on |
| a command **denied** by a hook | a protected branch, a force-push or discarding uncommitted work | nothing: the agent takes the alternative the denial names |
| the agent runs the tests before it finishes | it changed code after the last check | nothing: it reports the result |
| a note about the **branch** at session start | you are on production, detached, behind the integration branch, or on a branch whose PR was merged | let the agent switch or update, or tell it where to work |
| a **draft pull request** as soon as work starts | the team runs a pull request per task (`workflow.pullRequests`), so everyone sees what is in flight | follow it or comment on it; the agent merges it when the checks are green and deletes the branch |

## Which model, and what it costs

Not every step needs the best model. The agent hands each step to a helper running on the
cheapest model that does it well (`AGENTS.md`, "Who does what, on which model"): searching the code, reading
test output and writing the changelog on a small model; building from an agreed plan on a
mid-size one; plans and reviews on the strongest; the very hardest work on the top model. You
do not pick these: the helpers carry their own model.

You pick the model of your own session, which most of the tokens go through:

| For | In Claude Code |
|---|---|
| everyday work | `/model opusplan` — Opus while you plan (shift+tab to plan mode), Sonnet while it builds — or `/model sonnet` |
| a hard design or a bug that resists | `/model opus` |
| the hardest, longest work | `/model fable`, where your plan includes it |

If this repository's setup chose a starting model for everyone (`agent-setup ... --session-model`),
sessions open on it; `/model` still changes yours for the session. In Codex and other tools,
choose the model the same way, in the tool's model picker.

**What did it cost?** `node .agents/hooks/session-eval.mjs --usage` (where the setup records
sessions) shows the cost per model, what handing steps to cheaper helpers saved, and whether
checks and corrections held up — the same numbers the maintainer reads.

## Commands (Claude Code)

| Command | For |
|---|---|
| `/deliver <task>` | the full cycle on purpose: brief, plan, build, verify, review, report |
| `/gates` | run the checks CI runs, cheapest first |
| `/ship-it` | commit and open a pull request the way this repository expects |
| `/handoff` | save where you are before a break or a fresh session |

The skills for each area (frontend, backend, API, security, architecture…) load on their own
when the work matches, and can be called by name.

## Feedback makes it better

- **Correct it plainly**: "no — use the existing date helper". Where the setup's learning loop
  is installed, the agent notes the lesson, and whoever maintains the setup turns it into a
  rule, a check or a skill overlay for everyone.
- **Never edit** `.agents/skills/`, the kit's agents or `.agents/hooks/`: they are replaced on
  every update. This repository's adaptations go in `.agents/overlays/<skill>.md`.

## Turning something off

`.agents/sdlc.config.json`, section `workflow`: `promptIntake` (the brief on large or risky
requests), `verifyBeforeStop` (the check before the agent finishes), `contextWarnTokens`. Turn
one off only with a reason, and write the reason in `.agents/docs/lessons.md`. The agent picks
the branch to work on by itself and names it; `askBranch: true` makes it ask you first.
`pullRequests: "per-task"` turns on a pull request per task; with it, `askMerge: true` makes the
agent ask you before it merges.
