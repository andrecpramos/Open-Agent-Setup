# Generating the workflow

## Why the kit ships skills, and what is still generated

Copying a ready-made `.claude/` into a repository fails: in one measured case **10 of 18
copied files diverged within one session** — each divergence a legitimate adaptation to the
repo it landed in. The kit keeps that lesson and splits the problem in two:

| Knowledge | Where it lives | Owner |
|---|---|---|
| **Universal** — true in any repo with this stack or domain (how to avoid a race, how to design an error format, how to run config-driven gates) | kit skills, agents and hooks | the kit; copied, versioned, updated |
| **Repo-specific** — this repo's layers, libraries, commands, traps | overlays, project skills, `sdlc.config.json`, docs | the project; generated here, never overwritten by the kit |

A kit skill that needs repo knowledge reads it from `sdlc.config.json`, the knowledge base,
and `.agents/overlays/<skill>.md`. That is why kit skills can be copied without drifting: the
part that would drift is not in them.

So the rule for this procedure is: **generate an asset when it encodes something this repo
knows that a competent agent would otherwise get wrong.**

## Choosing the form

Forms differ in **when they reach the agent**, which is the only thing that matters:

| Form | Reaches the agent | Use when |
|---|---|---|
| `AGENTS.md` project section | every session, every agent | needed for almost any task; costs context always — keep it short |
| Hook / guard rule | at the moment of the action (Claude Code sessions; branch protection on the host for everyone) | you need to *deny* something, or warn exactly when it is relevant |
| Gate | before merge, in CI and `/gates` | a rule that must hold for every change |
| Overlay | when the matching kit skill loads | a kit skill needs repo-specific knowledge |
| Project skill | when the task matches its description | a multi-step procedure unique to this repo |
| Path-scoped rule (`.claude/rules/`) | when matching files are read (Claude Code) | context that applies to certain files only |
| Agent | on explicit delegation | output volume is the problem — sweeps, audits, gate runs |

The ordering insight: **a hook is stronger than a skill, which is stronger than a document.**
A document is read by an agent that already suspects a problem; a hook fires whether or not
anyone suspected anything. Push each piece of knowledge as far up this list as it will go.

## Already provided by the kit — do not generate

`gates` + `gate-runner` (config-driven gate runs), `ship-it` (commit/PR procedure from
`commits` and `branching`), `handoff`, `enforcement-audit`, `docs-keeper`, and the domain
skills. If one of them needs to behave differently here, that is an **overlay**, not a copy.

## Generate when the survey says so

| Asset | Generate when the survey found… | Skip when… |
|---|---|---|
| `boundary-auditor` agent | a layer boundary a gate enforces — name the real layers in it | there is no boundary, or nothing checks it |
| `new-feature` skill | a non-obvious development loop — codegen, a declaration step, a fixture to regenerate | the loop is "edit, test, commit" |
| `write-adr` skill | an ADR convention that differs from the `architecture` skill's template | the template fits |
| `/rules-check` skill | a numbered rule register with mechanical checks | rules are informal |
| domain procedure skill | a recurring task with a correct order and a step people skip | — |

### A domain-specific skill is worth writing when

The task is done repeatedly, has a **correct order**, and has a step people skip. Name the two
most-skipped steps explicitly inside it — vague completeness checklists get skimmed; "the two
people actually skip are X and Y" gets read.

## Writing one that works

- **The description is the selector.** It is the only thing deciding whether the skill loads.
  Write the situations that should trigger it, in the words a user would use — not a summary
  of the contents.
- **Encode the failure, not the happy path.** The value is the sentence that begins "the
  mistake here is…". If a skill contains nothing an agent would get wrong, delete it.
- **Name the real commands** — exactly what CI runs.
- **Say what it will not do.** Boundaries stop adjacent actions nobody asked for — merging the
  PR, pushing to production, committing another session's files.

## Anti-patterns

- **One skill per SDLC phase.** Phases are documentation; skills are procedures.
- **A skill that restates the docs.** Link into the knowledge base; duplication is a second
  source of truth, and it drifts.
- **An agent for something cheap.** Delegation costs a context window; use it when output
  volume is the problem.
- **Copying a kit skill to change it.** Write an overlay. A copied kit skill stops receiving
  improvements and drifts silently.

## After generating

For each asset, write in the report **what repo-specific knowledge it encodes**. If you cannot
name that, delete it — an unjustified file in `.agents/` is one the next reader will assume is
load-bearing.
