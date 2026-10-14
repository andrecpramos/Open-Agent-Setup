---
name: deliver
description: >
  Deliver a change end to end: turn the request into a brief (goal, scope, acceptance), plan
  it, build it in small verified steps with the right domain skill, get it reviewed by the
  right specialist agent, and report against the acceptance line. The default workflow for
  feature work, bug fixes and refactors. Use whenever a request will touch more than one file
  or take more than a few steps; when it is vague ("make it faster", "clean this up", "the
  page is broken"); when it touches auth, payments, data or production; or when the user says
  "build", "implement", "add a feature", "take this from idea to PR", "end to end", "plan this
  change" or "faz isto de ponta a ponta". Loads alongside the domain skill for the area
  (frontend, backend, api-design…). Not for answering a question about the code, a one-line
  fix, running the gates alone (gates), opening a PR for finished work (ship-it) or a review
  with no change to make (security, architecture).
---

# Deliver

Most failed agent work fails before the first edit — the agent builds what it guessed, not
what was meant — or after the last one, when "done" is claimed without proof. This skill is
the cycle that prevents both: **brief → plan → build → verify → review → report**, sized to the
task so a one-file fix stays cheap and a cross-cutting change gets a plan and a second pair of
eyes. It sequences the other skills and agents; it does not replace them.

## Before you start

- Read `.agents/overlays/deliver.md` if it exists — this project's adaptation of the skill. It
  wins where the two disagree.
- Know the contract: AGENTS.md (commands, conventions), the gates in
  `.agents/sdlc.config.json`, and `.agents/docs/` when it exists.
- Load the domain skill for the area as soon as you know it — frontend, backend, api-design,
  security, design-system, architecture (`../<skill>/SKILL.md`). This skill says *when*; they
  say *how*.

## 1 · Brief

Restate the request at the top of your reply, five lines at most, so the user can correct it
in one line before any work is spent:

```
Goal: <the outcome, in the user's terms>
Scope: <in — the area, files or screens> · <out — what you will not touch>
Acceptance: <the test, command or visible behaviour that proves it is done>
Assumptions: <what you inferred and did not ask>
Risks: <auth, data, money, production, performance — or "none">
```

- **Fill gaps from the code, not from imagination.** Look at the area first — enough to size
  it and name the scope; from M up, the planner does the deep reading — and mark what you
  inferred as an assumption.
- **Ask at most two questions, and only where a wrong guess would waste real work** (a data
  model, a public contract, a destructive step). Otherwise state the assumption and carry on.
- **Size it**: XS (one line, one file) · S (one area, a few files) · M (a feature across
  layers) · L (cross-cutting, risky, or more than a day). Sizing decides the rest.

Weak-to-strong examples and the sizing table: [references/brief.md](references/brief.md).

## Who does each step, on which model

Each step runs on the cheapest model tier that does it well — AGENTS.md "Model tiers" names
the tiers and the agents that run on them. The size decides how much to hand off:

| Step | XS · S | M | L or risky |
|---|---|---|---|
| Explore | yourself | scout (low) | scout (low) |
| Plan | yourself, in a line or two | planner (high) | planner on the frontier tier; show the plan, wait for a yes |
| Build | yourself | implementer (medium), step by step — or yourself if you run on medium | implementer step by step; a step the plan marks high, on high |
| Verify | the check | gate-runner (low) | gate-runner (low) |
| Review | — | code-reviewer (high) | every reviewer that applies (high); security on frontier where money, auth or data loss is at stake |
| Docs | yourself | doc-writer (low) | doc-writer (low) |

A subagent starts cold and re-reads what you already have, so handing off pays only when the
step is bigger than that. Move a step up a tier on evidence — it failed twice, or the reviewer
found a design flaw — and never move a review of risky work down to save money. How to brief
each agent and escalate one: [references/delegation.md](references/delegation.md).

## 2 · Plan (S and up)

- **M and up: hand the plan to the planner** (where your tool has subagents) — the brief in,
  the plan out, with the tier each step needs. Give it the request before you read the code
  yourself: keeping that reading out of your context is the point. A request that only asks for
  a plan is planner work too.
- **S: map before you change.** More than a handful of files to understand → delegate the
  reading to the scout agent and work from its `file:line` map.
- **Write the steps** (the planner's job from M up): which files, in what order, each step small
  enough to leave the build green. Name the test that will prove the acceptance line — for a
  behaviour change, write it first and watch it fail.
- **L or risky: show the plan and wait for a yes** before editing. A plan corrected costs one
  message; a wrong implementation costs the day.

## 3 · Build

- One step at a time; run the fast check for what you touched after each (the post-edit hook
  does part of this). Do not stack five unverified edits.
- **A plan with more than a few edits goes to the implementer**, one step at a time — unless
  you run on the medium tier yourself, where it would save nothing. Check each report: the
  step's check, the files it changed. A step it returns BLOCKED with a question is yours (or
  the planner's) to decide. A plan the user hands you counts: "build this" is not a reason to
  type it out on the planning model.
- Stay in scope. Something unrelated and broken goes in the report, not in the diff.
- New dependency, service or schema change: state the reason and the cost in the report.

## 4 · Verify

- After the **last** edit: the acceptance test, then the gates (the gates skill, or the
  gate-runner agent when the output would flood the conversation). Keep the exit status
  visible — never pipe a check into `head` or `tail`.
- UI changes are verified in a real browser (the agent-browser skill,
  `../agent-browser/SKILL.md`, when it is installed), not by reading the JSX.

## 5 · Review (M and up, and every risky change)

Delegate review — the author is the worst reviewer of their own diff. Run the reviewers that
apply **in parallel**, each with the brief and the diff:

| Change | Reviewer |
|---|---|
| a change across several files or layers (M and up), or any risky one | code-reviewer |
| auth, sessions, permissions, payments, personal data, uploads, outbound requests, webhooks, LLM tools | security-reviewer |
| a new module, dependency, service, queue or datastore; crossing layers | architecture-reviewer |

Fix every high finding, or say why not. Re-run the checks after the fixes. Briefing a
subagent well, running agents in parallel, and checking what they return:
[references/delegation.md](references/delegation.md).

## 6 · Report

Against the brief, in this order: acceptance met or not, with the evidence (test name, command
and result, screenshot); what changed (files, one line each); review findings and what you did
with them; **what you could not verify**; follow-ups. M and up: one line on who did each step
and on which tier (`plan: planner (high) · build: implementer ×3 (medium) · review:
code-reviewer (high)`), so the routing can be checked against what it cost. Then stop: commit or open a PR only when
asked (`../ship-it/SKILL.md`); pausing mid-way → `../handoff/SKILL.md`. A correction from the
user along the way is a lesson → `../self-improve/SKILL.md`.

## The mistakes that matter

- **Editing before the acceptance line exists.** Without it the agent decides what "done"
  means, alone, at the end. Write the brief first — written afterwards it is decoration.
- **Asking ten questions, or none.** Both waste the user's time. Ask what a wrong guess would
  make expensive; assume and state the rest.
- **One big unverified change.** Fifteen files edited, then one test run, then an afternoon
  bisecting your own work. Small steps, each left green.
- **Over-orchestrating small work.** A plan document and four agents for a one-line fix cost
  more than the fix. XS: brief in one line, fix, verify, report.
- **Every step on the top model.** Searching, reading gate output and updating the changelog
  on the model that plans is paying the high rate for low work; so is typing out a finished
  plan. Hand those down from M up.
- **Saving on judgement.** A plan or a review of auth, money or data on a cheap tier to save a
  few cents; a step retried a third time on the tier that already failed it twice. Move it up.
- **Delegating writing in parallel.** Two agents editing the same files produce conflicts and
  a diff nobody understands. Delegate reading and reviewing; keep the writing in one place.
- **Vague delegation.** "Look at the auth code" returns an essay. Give the subagent the goal,
  the scope, what to return and in what shape — and check what comes back: a path that does
  not exist or a "looks fine" with no evidence is not a result.
- **Self-review only on risky paths.** Auth, money and data changes always get the specialist
  reviewer, however small the diff looks.
- **"Done" without the acceptance evidence.** Tests that were not run, a partial gate run
  reported as green, a UI never opened in a browser. Report what was checked and what was not.
- **Scope creep.** "While I was there" changes hide in the diff, break things nobody asked you
  to touch, and make the review harder.

## Done means

- The brief is at the top of the work, and the user had the chance to correct it.
- The acceptance test exists and passes after the last edit; the gates pass, or the report says
  which failed and why.
- M and up: the right reviewers ran, and their high findings are fixed or answered.
- The report states the evidence and what could not be verified.

Lessons this procedure taught the hard way go to `.agents/learnings/inbox.md`.
