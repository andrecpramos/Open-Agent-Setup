# `.agents/` — what this folder is

[Agent_Setup](https://github.com/andrecpramos/Open-Agent-Setup) put this folder here. It holds what the
coding agents in this repository use — Claude Code, Codex, Cursor, Copilot, Gemini CLI and others
all read it. It is text files and a few small Node scripts: no packages, nothing that runs inside
your application, nothing that sends data anywhere.

**If you write code here:** read [WORKFLOW.md](WORKFLOW.md) — one page. You install nothing.

| In this folder | What it is | Edited by |
|---|---|---|
| `WORKFLOW.md` | How to work with the agent here: how to ask, what you will see | the kit |
| `skills/` | Playbooks, one folder each (frontend, backend, security…). The agent opens the one that matches the work | the kit |
| `hooks/` | Small scripts your coding agent runs at set moments (Claude Code directly; Codex, Cursor, Copilot, Antigravity and Windsurf through `run-hook.mjs` and their own hook file): they stop risky git commands (a push to production, discarding your uncommitted work) and make sure the work was checked before the agent says it is done | the kit |
| `agents/` | Only for agents other than Claude Code: the helper agents' checklists (Claude Code keeps them in `.claude/agents/`, Codex in `.codex/agents/`) | the kit |
| `models.json` | The model tiers: which model the session (the orchestrator) and each kind of work run on, per provider, and what each model costs | the kit (change it in `sdlc.config.json`, section `models`) |
| `licenses/` | The licences of the kit and of the third-party skills it brings | the kit |
| `agent-setup.json` | The install record: which files are the kit's, so an update never touches yours | the kit |
| `sdlc.config.json` | Your branches and the checks your CI runs — what the hooks read | this project |
| `overlays/` | This project's own rules for a skill ("our components live in…") | this project |
| `learnings/` | Lessons the agent noted, waiting to become rules (when the setup includes them) | this project |
| `docs/`, `decisions/` | What is true about this project, and the decisions behind it (written by `/sdlc-init`) | this project |

**Files marked "the kit"** are replaced by `agent-setup update`, and only while nobody changed
them — a changed one is kept, with the new version put beside it. To adapt a skill to this
project, write an overlay instead of editing it.

**To remove all of it:** run `agent-setup uninstall` on this repository from the Agent_Setup kit.
It removes exactly what it added and leaves everything this project wrote.
