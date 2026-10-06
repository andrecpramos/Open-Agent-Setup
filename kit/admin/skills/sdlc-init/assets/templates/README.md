# The knowledge base — `.agents/docs`, `decisions/`

What is **true** about this project. Skills, hooks and agents are how the work gets
done; this is what the work is done against. Neither restates the other — they link.
(Written to `.agents/` by default; a repo may keep it in `.ai/` or `docs/` instead —
`docs.root` in `sdlc.config.json` says which.)

Where this directory and an ADR disagree, **the ADR wins** and the disagreement is
a bug to be fixed, not a difference of opinion.

## Map

| File | Answers |
|---|---|
| [project.md](./docs/project.md) | What this is, what state it is in, what is verified vs assumed |
| [rules.md](./docs/rules.md) | The numbered invariants. Each one traced to its enforcement |
| [critical-infrastructure.md](./docs/critical-infrastructure.md) | **Rule → enforcement → status.** Read this before assuming anything is protected |
| [decisions/](decisions/) | ADRs. The constitution |
| [lessons.md](./docs/lessons.md) | Dated lessons this repo taught the hard way (append-only) |
| `overlays/` | This repo's adaptations of the kit skills — architecture, security, testing and the rest of what an area needs, read by that skill before it starts |
| `sdlc.config.json` | The machine-readable version of all of it. Hooks and skills read this |

## The rule that keeps this honest

**Every claim here is verifiable against the tree, or it is labelled as a plan.**

A knowledge base drifts by default: code moves, documents don't. Three things
push back —

1. Each document carries an **audit date** in its header. A date older than the
   last significant change to what it describes is a warning.
2. `critical-infrastructure.md` distinguishes *written down* from *enforced*, and
   never claims protection that does not exist.
3. The `docs-keeper` agent verifies claims against the tree rather than against
   other documents, which is the failure mode that produces a consistent and
   entirely wrong knowledge base.

If you find a document that is wrong, fixing it is in scope for whatever you were
already doing. Leaving it is how the next person stops trusting all of them.

## For an agent reading this cold

Read in this order, and stop when you have what you need:

1. `project.md` — where things stand
2. `rules.md` — what you must not break
3. The kit skill for the area you are working in, which reads its overlay

Do not read all of it. A full pass costs more context than most tasks are worth,
and the parts you need are the three above.
