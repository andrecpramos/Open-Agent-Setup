# Agent_Setup

**Teach your AI coding agent to work like a careful engineer. Set it up once, for your whole team.**

AI coding agents are assistants that read and change your code for you, such as Claude Code,
Codex, Cursor and GitHub Copilot. They are fast, but they guess. They don't know how your
project is tested, they sometimes skip the checks, and they can run a command that throws away
your work. Agent_Setup adds a small folder of instructions and scripts to your project that
fixes this. You install it once; everyone who opens the project with a coding agent gets it, and
they install nothing.

- [What it does](#what-it-does)
- [Install it, step by step](#install-it-step-by-step)
- [Using it day to day](#using-it-day-to-day)
- [Update or remove it](#update-or-remove-it)
- [Troubleshooting](#troubleshooting)
- [Which agents it works with](#which-agents-it-works-with)
- [How it works](#how-it-works)
- [For whoever maintains the setup](#for-whoever-maintains-the-setup)

## What it does

| | In plain words |
|---|---|
| **Playbooks** (called *skills*) | Short guides for frontend, backend, APIs, security and architecture. The agent opens the right one when the work matches. They are written around the mistakes agents actually make. |
| **Safety rails** (called *hooks*) | Small scripts that run on their own and stop a dangerous command before it runs: a push straight to production, a force-push, or anything that would throw away work you haven't committed. |
| **Checks before "done"** | After an edit, the agent runs the test or check that covers it. If it changed code since the last passing check, it is asked to check again before it says "done". |
| **A brief for big or risky work** | Before touching login, payments, data, production or secrets, the agent writes a short plan — the goal, what is in and out, how you'll know it's done — that you can correct in one line. |
| **Helpers on the right model** | Helper agents plan, build, review and document, each on the model that is worth its price for that step: searches and docs on a small, cheap model, building on a mid-size one, plans and reviews on the strongest, the hardest work on the top one. For Claude, Codex and Gemini. |
| **Cost you can see** | One command shows what the work cost, model by model, what handing steps to cheaper helpers saved, and whether the checks held up while it did. |

What it is **not**: no npm packages, nothing installed globally, nothing that runs inside your
application, nothing sent anywhere, and none of your files overwritten. It is plain text and
small Node.js scripts you can read, and one command removes it.

## Install it, step by step

### Before you start

| You need | Check it by running | You should see |
|---|---|---|
| **Node.js** 18.17 or newer | `node --version` | `v18.17.0` or higher (`v20`, `v22` and later are fine) |
| **git** | `git --version` | `git version 2.…` |
| **Your project in git** | `git status`, inside your project folder | anything but `not a git repository` |
| **A coding agent** | — | Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Antigravity, Windsurf, or any agent that reads `AGENTS.md` |

Missing something?

- **Node.js:** install the **LTS** version from [nodejs.org](https://nodejs.org), then open a new terminal.
- **git:** install it from [git-scm.com](https://git-scm.com).
- **Project not in git yet:** inside your project folder, run `git init`, then `git add -A`, then
  `git commit -m "First commit"`.

The commands below are the same in Terminal (macOS, Linux) and in PowerShell or Git Bash
(Windows). The examples use a folder called `code` that holds your project, `my-app`. Use your
own names.

### Step 1 — Download the kit (once per computer)

```bash
cd ~/code
git clone https://github.com/andrecpramos/Open-Agent-Setup.git
```

You now have an `Open-Agent-Setup` folder next to `my-app`. There is nothing else to install: the kit
has no dependencies, so there is no `npm install`.

### Step 2 — Install it into your project

Run the install, with `--targets` set to the agent you use:

```bash
node Open-Agent-Setup/bin/agent-setup.mjs install my-app --targets claude
```

| If you use | Add |
|---|---|
| Claude Code | `--targets claude` |
| Codex | `--targets codex` |
| Cursor | `--targets cursor` |
| GitHub Copilot | `--targets copilot` |
| Gemini CLI | `--targets gemini` |
| Antigravity | `--targets antigravity` |
| Windsurf | `--targets windsurf` |
| more than one | separate them with commas: `--targets claude,cursor` |
| something else | leave `--targets` out |

> **Why `--targets` matters:** the installer only sets up the agents it can already see in your
> project, such as a `.claude/` folder. In a new project it sees none: your agent would get the
> written instructions, but not the safety rails or, in Claude Code, the `/` commands.

First it shows what it found and everything it will add, then asks `Install? [Y/n]`. Press Enter.
Check the `Agents` line in what it prints: it should name your agent. It ends with a short
**Next** list, which matches the steps below.

### Step 3 — Let your agent finish the setup

The installer makes a first guess about your branches and your checks. Your agent now confirms
it, by reading your CI configuration and your git branches:

- **Claude Code:** open the project (restart Claude Code if it was already open) and type `/sdlc-init`.
- **Any other agent:** open the project and ask it to *"follow .agents/skills/sdlc-init/SKILL.md"*.
  In Codex, also approve the project's hooks once, with `/hooks`.

This takes a few minutes. The agent fills in `AGENTS.md`, records the commands that test and
check your project, and writes a few short documents about it in `.agents/docs/`. Until this
step runs everything works, but the settings are marked *provisional*.

### Step 4 — Check that it worked

```bash
node Open-Agent-Setup/bin/agent-setup.mjs status my-app
```

You should see `(current)` next to the version, and, once step 3 is done, no warning that the
config is provisional. In Claude Code you can also type `/`: `/deliver`, `/gates`, `/ship-it` and
`/handoff` are in the list.

### Step 5 — Commit it, and tell your team

```bash
cd my-app
git status
git add -A
git commit -m "Add Agent_Setup"
```

`git status` shows what was added. `git add -A` takes every change in the folder, so if you had
other unfinished work, add the kit's files by name instead: `AGENTS.md`, `.agents/`,
`.gitignore`, and your agent's folder, such as `.claude/`.

Share it the way you share any change, with a push or a pull request. Your teammates install
nothing: they pull, open the project in their agent, and read **`.agents/WORKFLOW.md`**, a single
page on how to work with it.

**You're set up.**

## Using it day to day

Work the way you already do. A few habits get the most out of it; the full page for your team is
[`.agents/WORKFLOW.md`](kit/templates/workflow-guide.md).

1. **Say what you want, where, and how you'll know it's done.** For example: *"Logging in with a
   correct password says 'invalid credentials'. Fix it in `src/auth/`. Done when the login test
   passes."*
2. **Small fixes just happen.** Big or risky work starts with a short brief: correct it in one
   line, or say go.
3. **Read the report.** It says what was checked, and what could not be.
4. **Say "ship it"** when you want a commit and a pull request. Nothing is pushed before that,
   and production only changes when someone asks for a release. A team can instead run a pull
   request per task: each change opens a draft PR when work starts, so everyone sees what is in
   flight, and the agent merges it when the checks are green and deletes the branch
   (`workflow.pullRequests` in `.agents/sdlc.config.json`; `/sdlc-init` asks).

| You might see | It means |
|---|---|
| a **brief** before any change | the request looked big or risky, so the agent wrote down what it understood — check it |
| a command **denied** | a safety rail stopped a risky git command; the agent takes the safer route it names |
| the tests running before it finishes | it changed code after the last check, so it checks again |
| a note about your **branch** when a session starts | you are on the production branch, or behind the branch the team works on |
| **Context: this window is at about …k tokens** | the conversation has grown large: when the task is done, `/clear` (after `/handoff` if the work continues) |

In Claude Code, four commands help: `/deliver <task>` runs the full cycle on purpose (brief,
plan, build, check, review, report), `/gates` runs the checks your CI runs, `/ship-it` commits and
opens a pull request, and `/handoff` saves where you are before a break.

## Update or remove it

**To update** to the latest kit, run these two commands from the folder that holds both, then
commit the result:

```bash
git -C Open-Agent-Setup pull
node Open-Agent-Setup/bin/agent-setup.mjs update my-app
```

Your changes are never overwritten. If you edited a file the kit installed, the new version is
saved next to it as `<file>.kit-new` for you to compare. To adapt a playbook to your project,
write your rules in `.agents/overlays/<skill>.md` rather than editing the playbook.

**To remove it:**

```bash
node Open-Agent-Setup/bin/agent-setup.mjs uninstall my-app
```

This removes everything the kit added. Files that have become your project's own stay: your
settings in `.agents/sdlc.config.json`, the notes in `.agents/learnings/`, and the documents
`/sdlc-init` wrote. It lists them, so you can delete them by hand if you want.

## Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found`, or `'node' is not recognized` | Install Node.js (LTS) from [nodejs.org](https://nodejs.org), then open a **new** terminal. |
| `Error: Cannot find module '…/Open-Agent-Setup/bin/agent-setup.mjs'` | You are not in the folder that contains `Open-Agent-Setup`. `cd` into it, or type the full path to `agent-setup.mjs`. |
| `error target is not a directory` | The path to your project is wrong. Check it with `ls` (or `dir`), and put quotes around a path that has spaces. |
| The install says `Agents: none found` | You left out `--targets`. Add your agent now: `node Open-Agent-Setup/bin/agent-setup.mjs update my-app --targets claude` (or your agent's name, from step 2). |
| `/sdlc-init` is missing in Claude Code | Claude Code was not set up. Run the `update … --targets claude` command above, then restart Claude Code. |
| The safety rails don't seem to run | Restart your agent: hooks load when a session starts. In Codex, approve them once with `/hooks`. |
| A teammate's Claude Code doesn't list the skills | Their first session sets them up and says so: type `/reload-skills`, or restart Claude Code. |
| On Windows, `git add` prints many `LF will be replaced by CRLF` warnings | Harmless: git is adjusting line endings for Windows, and the kit ignores the difference. |
| A file ending in `.kit-new` appeared after an update | You had changed that kit file. Compare the two, keep what you want, and delete the `.kit-new` file. |
| Anything else | `node Open-Agent-Setup/bin/agent-setup.mjs status my-app` shows what is installed and any warnings. |

## Which agents it works with

The instructions and playbooks work in every agent that reads `AGENTS.md`. The safety rails need
an agent with hooks, so how much of them runs depends on the agent:

| | Instructions and playbooks | Blocks risky git commands | Check after an edit | Branch note | Brief for risky requests | Check before "done" |
|---|---|---|---|---|---|---|
| Claude Code | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Codex | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Cursor | ✓ | ✓ | ✓ | ✓ | — | — |
| GitHub Copilot (CLI, cloud agent) | ✓ | ✓ | ✓ | ✓ | — | — |
| Antigravity | ✓ | ✓ | — | — | — | — |
| Windsurf | ✓ | ✓ | — | — | — | — |
| Gemini CLI and any other agent | ✓ | — | — | — | — | — |

A dash means that agent has no hook that can do the job. The rule is still written in
`AGENTS.md`, and branch protection on your git host still guards production for everyone.

---

## How it works

An install adds this to your project:

```
my-app/
├── AGENTS.md              instructions every coding agent reads, added below your own text
├── .agents/               the kit, in one folder
│   ├── WORKFLOW.md        one page for your team: how to ask, what they will see
│   ├── README.md          what each part is, who edits it, and how to remove it
│   ├── skills/            the playbooks
│   ├── hooks/             the safety-rail scripts
│   ├── models.json        which model each kind of work runs on, and what each costs
│   └── sdlc.config.json   your branches and checks
├── .claude/               only for Claude Code: turns the hooks on, adds the helper agents
├── .codex/agents/ …       only for the other agents you chose: the helpers in Codex's format,
├── .cursor/hooks.json …   and the same hooks turned on there
└── .gitignore             a few lines for files that stay on each computer
```

Every file is ordinary text that shows up in `git diff` before you commit. Already have an
`AGENTS.md`, a `CLAUDE.md` or a `.claude/settings.json`? The kit adds to them and never replaces
them. And a skill or agent of yours with the same name as one of the kit's wins: the kit's is
skipped.

When you ask for something, the agent follows one path:

```
"make checkout faster"
   │
   ├─ small, in one place? ──── read → change → check → report
   │
   └─ big or risky? ─────────── brief (goal · scope · how we know it's done) → you confirm
                                → plan → build in small, checked steps → reviewers → report

   all along, the hooks: block risky git commands · check after each edit · a check before "done"
```

### Playbooks (skills)

The installer picks the set that fits your project and says which it chose: a React and Express
app gets more than a small library. `--profile` changes the choice.

| Skill | For |
|---|---|
| `frontend` · `backend` · `api-design` · `security` · `architecture` | the parts of your stack, each installed when it fits the project |
| `design-system` | your own UI tokens and components (web and frontend projects) |
| `agent-eval` | testing features built on an LLM (AI products) |
| `deliver` · `gates` · `ship-it` · `handoff` | the workflow: the full cycle, the checks, shipping, pausing — always installed |
| `design-taste-frontend` · `agent-browser` | UI work, opt-in with `--skills @design`: a design direction (a long skill, about 22k tokens each time it loads), and checking the result in a real browser |

`agent-browser` needs a one-time install on each computer:
`npm i -g agent-browser && agent-browser install`.

The kit's own skills come with test cases, so each one is measured against the same agent
working without it. The two design skills come from other open-source projects
([credits below](#third-party-skills-and-licences)).

### Helper agents, each on its model

| Agent | Steps in when | Model tier |
|---|---|---|
| `scout` | there is a lot of code to read; it returns a map of where things are, not whole files | low |
| `planner` | a feature or change across layers: it turns the brief into small, checkable steps | high (frontier for critical work) |
| `implementer` | an agreed plan to build: one step at a time, with the step's check | medium |
| `gate-runner` | before a commit or pull request: answers MERGE-SAFE or BLOCKED | low |
| `code-reviewer` | a change touches several files or layers, or is risky | high |
| `security-reviewer` | login, permissions, payments, personal data, uploads, webhooks, AI tools | high (frontier when money, auth or data loss is at stake) |
| `architecture-reviewer` | a new module, dependency, service or database | high |
| `doc-writer` | the changelog, README and docs for a finished change | low |

Agents that cannot run helper agents follow the same checklists themselves.

**The tiers.** Four levels, each a model per provider ([kit/models.json](kit/models.json), with
the price of each and where it came from):

| Tier | For | Claude | OpenAI (Codex) | Gemini |
|---|---|---|---|---|
| frontier | the hardest work: critical plans, bugs that survived two attempts | Fable | GPT-6 Astra | Gemini 3.1 Pro, high thinking |
| high | planning, reviews, debugging | Opus | GPT-6.1 Sol, high effort | Gemini 3.1 Pro |
| medium | building to a plan, tests, routine fixes | Sonnet | GPT-6.1 Sol, medium effort | Gemini 3.8 Flash |
| low | searching, check output, docs, mechanical edits | Haiku | GPT-6 Luna | Gemini 3.5 Flash-Lite |

**The orchestrator.** The session you talk to plans and routes: it runs on the strongest model
the account has — in Claude Code it starts on `best`, which is Fable where the plan includes it
and Opus otherwise — and keeps for itself only what needs that model: the brief, the plan's
decisions, routing each step, checking what comes back. Everything else goes to the helper whose
tier does it well.

Small work stays with the orchestrator: a helper starts cold and re-reads what you already
have, so it pays only for bigger steps. In Claude Code each helper carries its model; in Codex
the install writes the same helpers as Codex agents (`.codex/agents/`) on the OpenAI column; any
other agent reads the table in `AGENTS.md`. A project can run a tier on another model, or use
its own prices, in `.agents/sdlc.config.json` ([docs/PLAYBOOK.md](docs/PLAYBOOK.md#configuration)).
`agent-setup usage <project>` shows what it all cost and what the routing saved.

### Safety rails (hooks)

They stay silent until something needs doing.

| Hook | Does |
|---|---|
| `guard-git` | blocks writes to production, force-pushes to shared branches, commands that throw away uncommitted work, and skipping git's own checks or the pull request's (`gh pr merge --admin`), and names the safer alternative each time. Pull requests are the normal path and pass; with a pull request per task, commits on the integration branch do not |
| `check-gates` | right after an edit, runs the quick check that edit could have broken |
| `stop-check` | when the agent is about to finish with code changed since the last passing check, asks once for the check — and for risky work (login, payments, data, secrets, production) that no reviewer has looked at, for the review too |
| `prompt-intake` | for a big or risky request, asks for the brief before the first edit; for a docs task or a plan to build, names the cheaper helper to hand it to; with a pull request per task, reminds the agent to open the draft PR first; everything else passes silently |
| `branch-check` | at the start of a session, speaks up only when the branch needs attention |
| `context-budget` | past 150k tokens in a conversation, asks the agent to delegate and read less, and tells you to `/clear` once the task is done (`/handoff` first if it continues); after `/clear`, points the agent to that handoff |

Routine commands don't ask: the setup approves what the workflow runs again and again — your
gates, reading git and the pull request, and (where `guard-git` runs) adding, committing and
switching branches. Pushing still asks. Auto mode, the default on recent Claude Code, covers the
rest with its own safety check.

The hooks stop the agent early, but the real safety net for production is **branch protection
on your git host** (required pull requests and checks): it holds for every agent and every
person, so turn it on. Why each rule is the way it is: [docs/SDLC.md](docs/SDLC.md).

## For whoever maintains the setup

The kit has two roles. Everyone gets the **developer** role: the playbooks, the workflow, the
reviewers and the safety rails. The **admin** role is for whoever installs the kit and keeps it
improving. It adds `/sdlc-init`, `/self-improve` and `/enforcement-audit`, which run only when
called by name and so cost developers nothing, and silent hooks that record how sessions go and
note the lessons from corrections. Both are installed by default; `--roles developer` leaves the
admin role out.

### Install options

| Option | Does |
|---|---|
| `--dry-run` | show what would change, write nothing |
| `--yes` | don't ask first (for scripts and CI) |
| `--targets claude,codex,…` | which agents get set up (default: the ones the project already shows) |
| `--profile <name>` | the skill set: `web` · `frontend` · `service` · `ai-app` · `library` · `standard` · `minimal` · `full` (default: chosen from what the project contains) |
| `--skills @design,agent-eval` · `--exclude <skill>` | add or leave out skills or whole groups |
| `--roles developer` | the developer role only: no learning loop, no session recorder |
| `--setup measure` | record a baseline before turning the kit on ([below](#measure-before-you-switch-it-on)) |
| `--session-model opusplan` | the model every Claude Code session starts on, for the whole team. Unset, it is the orchestrator's: `best` (Fable where the account has it, else Opus). `opusplan` plans on Opus and builds on Sonnet — the cheaper choice, with the helpers on their own models. Never replaces a model the project's settings already choose; `none` leaves it to each person |
| `--no-hooks` · `--verbose` | no Claude Code hooks · list every file |

`node Open-Agent-Setup/bin/agent-setup.mjs help` lists every command and option. To try the kit
without cloning it: `npx github:andrecpramos/Open-Agent-Setup install my-app` (updating many
projects and the maintainer commands need the clone). Tip: `npm link` in the kit folder puts
`agent-setup` on your PATH.

### Measure before you switch it on

To know what the kit changes, `--setup measure` installs only the session recorder, nothing the
agent sees, so a week or two of normal work becomes the baseline. Then
`agent-setup update my-app --setup full` turns the kit on, and
`agent-setup evals --project my-app` shows before and after side by side. How to run that pilot:
[docs/PLAYBOOK.md §1](docs/PLAYBOOK.md#1--pilot-a-repository--the-honest-comparison).

### The admin's tools

| Tool | Does |
|---|---|
| `/sdlc-init` | writes and checks the project's branches, checks and short knowledge base, and the first playbook additions |
| `/self-improve retro` | turns the lessons the agent noted into a guard rule, a check, a playbook addition or a note, and sends the ones that apply everywhere back to the kit |
| `/enforcement-audit` | compares what the repository claims with what it actually enforces, and ranks the gaps |
| `docs-keeper` | an agent that keeps the knowledge base true after structural changes |
| `session-eval` (hook) | one row of facts per context window — tokens per model, the helpers' included, checks after the last edit, corrections — at no token cost |
| `learning-signals` (hook) | notices a correction ("I told you…") so the agent notes the lesson; stops a command that failed three times |

The two hooks run in Claude Code.

### How it gets better

Corrections and session facts flow into a lesson inbox. `/self-improve retro` turns each lesson
into the strongest fix that makes it stick in that project, and the lessons that apply everywhere
become kit changes, each with a test case, that reach every project with `update --all`. The
loop end to end: [docs/SELF-IMPROVEMENT.md](docs/SELF-IMPROVEMENT.md). What to do each week, and
the numbers to watch: [docs/PLAYBOOK.md](docs/PLAYBOOK.md).

### Commands

| In your projects | |
|---|---|
| `agent-setup status <project>` | version, local changes, links, settings, lessons waiting |
| `agent-setup update <project>` / `--all` | bring one project, or every project, to the current kit |
| `agent-setup uninstall <project>` | remove what the kit added |
| `agent-setup usage <project>` / `--all` | what the work cost, model by model and tier by tier; what routing steps to cheaper helpers saved; whether quality held (`--session current` for the live session, `--vs high` to compare with one tier) |
| `node .agents/hooks/session-eval.mjs --summary` · `--usage` | inside a Claude Code project: how its sessions went, and what they cost |

| In the kit | |
|---|---|
| `agent-setup report` | the weekly cycle on one screen: projects, scorecards, metrics, and the next actions ranked (`--harvest`, `--md <file>`) |
| `agent-setup evals` | scorecards against their baselines (`--check` is the CI gate, `--promote` accepts one), session metrics, before vs after |
| `agent-setup eval-outcomes --skill <s> --save` | runs each test case with the kit and without it; a blind grader scores both |
| `agent-setup eval-routing --suite all --save` | which skill or agent a real agent picks for a request |
| `agent-setup harvest` | collect lesson proposals from every project into `inbox/` |
| `agent-setup list` · `lint` · `npm test` | the roles and catalog; the kit's own checks |
| `agent-setup new-skill <name> --group domain` | start a skill that already passes lint (`--group admin` for the admin role) |
| `agent-setup import <github-url>` | add a third-party skill, with its source and licence |
| `agent-setup export <dir>` | self-contained copies of the skills ([below](#other-ways-to-use-the-skills)) |
| `agent-setup vendor status` · `vendor sync` | what changed upstream in the third-party skills · take it in |

### Other ways to use the skills

Every route delivers the same skills; only `install` adds the safety rails, `AGENTS.md` and the
learning loop.

| Where | How |
|---|---|
| any agent, in one project or all of them | `agent-setup export <dir>` (`--profile`, `--skills`, `--roles` as for install), then `npx skills add <dir> --skill '<names or *>' -a <agents>`; add `-g` for every project. `--roles admin` gives an admin their own skills everywhere |
| claude.ai or Claude Desktop | zip one folder from `<dir>/skills/` of an export and upload it under Settings → Capabilities → Skills |
| an agent without skill support | point it at `kit/<role>/skills/<name>/SKILL.md`, or paste the file into the conversation |

These routes copy one skill folder at a time, so they take it from an **export**, which puts a
LICENSE in every skill folder and removes the settings only Claude Code understands. Details:
[docs/ARCHITECTURE.md §5](docs/ARCHITECTURE.md#5--vendoring-and-the-copy-a-folder-routes).

## Third-party skills and licences

Two skills come from other open-source projects. `agent-setup vendor sync` copies them exactly,
and they are never edited by hand: the only local changes are recorded in
[kit/vendor.json](kit/vendor.json), each with its reason, and the exact upstream commits in
`kit/vendor.lock.json`. Each licence is kept once, in
[kit/developer/licenses/](kit/developer/licenses/), and travels with every copy: an install puts
the ones a project needs in `.agents/licenses/`, and an export puts each in the skill folder it
covers.

| From | Skill | Licence |
|---|---|---|
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | `design-taste-frontend` | MIT |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | `agent-browser` | Apache-2.0 |

The upstream skills left out on purpose are listed in `kit/vendor.json`, each with its reason.
One of them, Vercel's `web-design-guidelines`, is out because its repository declares no
licence, so it cannot be redistributed.

## Licence

[MIT](LICENSE). An install puts the kit's notice in `.agents/licenses/agent-setup.txt`, beside the
licences of the third-party skills it brings.

## Documentation

- [docs/PLAYBOOK.md](docs/PLAYBOOK.md) — what to do when: piloting a repository, the weekly cycle, the numbers and their targets, outcome evals, rolling out to a team
- [kit/templates/workflow-guide.md](kit/templates/workflow-guide.md) — the one-page guide for developers, installed as `.agents/WORKFLOW.md`
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it is built: layout, roles, ownership, install and update, vendoring, which agent gets what
- [docs/SDLC.md](docs/SDLC.md) — the safety rails and checks, and the reason behind each rule
- [docs/SELF-IMPROVEMENT.md](docs/SELF-IMPROVEMENT.md) — the learning loop end to end
- [docs/AUTHORING.md](docs/AUTHORING.md) — writing and testing skills, and taking in third-party ones
- [docs/maintaining/](docs/maintaining/) — for whoever maintains the kit: [harvest](docs/maintaining/harvest.md) and [release](docs/maintaining/release.md)
- [CHANGELOG.md](CHANGELOG.md)

The idea behind it: a written rule is followed until someone is in a hurry. So the kit makes the
important rules automatic, keeps everything else out of the way, and says honestly which rules
it does not enforce.
