<!-- agent-setup:begin -->
<!-- Managed by agent-setup v{{KIT_VERSION}}. `agent-setup update` rewrites everything between these markers — put project-specific instructions above this block. -->

## How work flows here

Size the work first. A small fix in one place: read the code, make the change, run the check
that covers it, report. Anything larger, vague, or touching auth, payments, data or production:
follow the `deliver` skill (`.agents/skills/deliver/SKILL.md`) — a five-line brief, a plan,
small verified steps, a review, a report against the acceptance line. Commit or open a PR only
when asked.

### Who does what

{{TEAM_TABLE}}

## Working agreement

1. **Orient before you edit.** Read the code you will change, its tests, and one neighbour
   that already does something similar. Match the patterns in the tree over your own taste.
2. **Use the matching skill.** {{SKILLS_LOCATION}}
   If your tool does not load skills automatically, open the `SKILL.md` for the area you are
   touching before you start.
3. **Project overlays win.** `.agents/overlays/<skill>.md`, when present, is this repo's
   adaptation of that skill and overrides it where the two disagree. Never edit the kit's own
   files (`.agents/skills/`, `.agents/hooks/`, the kit's agents) to adapt them: the next update
   overwrites the change. Write an overlay instead.
4. **Verify, then claim.** Done means the gates pass (`/gates`, or the list in
   `.agents/sdlc.config.json`) and you have evidence — output, a test, a screenshot. Run the
   check *after* your last code edit, and say what you could not verify.
5. **Stay in scope.** Keep the diff to what was asked; report unrelated problems instead of
   fixing them silently. Ask before anything destructive or outward-facing — deleting data,
   force-pushing, publishing, sending messages, spending money.
6. **Work economically.** Search first, then read the lines you need; keep command output short,
   but never pipe a check into `head` or `tail` — that hides its exit status. Delegate broad
   reading and full reviews to the agents above where your tool has them.

## Skills

{{SKILLS_TABLE}}

## Knowledge base

| Where | What |
|---|---|
| `.agents/docs/project.md` | Start here — what this is, current state, what is verified vs assumed |
| `.agents/docs/rules.md` | Numbered invariants, each traced to what enforces it |
| `.agents/docs/critical-infrastructure.md` | What is *actually* enforced — read before trusting that anything is protected |
| `.agents/docs/lessons.md` | Dated lessons this repo taught the hard way |
| `.agents/decisions/` | ADRs. Where a document and an ADR disagree, the ADR wins |
| `.agents/sdlc.config.json` | Branches, gates and guards — the contract the hooks and skills read |

{{KB_NOTE}}

{{LEARNING_LOOP}}{{CLAUDE_SECTION}}## Boundaries

- Never commit secrets, credentials or personal data, and never print them.
- The production branch moves only when the user explicitly asks for a release in the current
  session. {{ENFORCEMENT_NOTE}}
  When a hook denies a command, take the alternative it names; never bypass one
  (`--no-verify`, `HUSKY=0`, escape variables).
- Never disable, skip or weaken a gate, test, lint rule or hook to get to green. Fix the cause,
  or stop and report it.
- New dependencies, services and infrastructure need a stated reason and a stated cost.
<!-- agent-setup:end -->
