## Claude Code

- **Hooks** (`.claude/settings.json`) back this agreement and stay silent until they have
  something to say: `guard-git` denies production writes and work-destroying git commands from
  the Bash and PowerShell tools and names the alternative — take it rather than working around
  it; `check-gates` runs the fast check an edit could break; `stop-check` asks once for a check
  when code changed after the last one; `prompt-intake` asks for a brief when a request is
  large or touches auth, payments, data, production or secrets, and names the cheaper agent for
  a docs task or a plan to build — hand the work over; `branch-check` speaks at
  session start only when the branch needs attention.{{ADMIN_HOOKS}}
{{CLAUDE_AGENTS}}
- **Commands:** {{CLAUDE_COMMANDS}}
- **Memory:** personal preferences belong in auto memory or `CLAUDE.local.md`. Project facts
  belong in `.agents/docs/`, where every agent can read them — not only Claude.
- Skills missing in a fresh clone? The session-start hook links them into `.claude/skills/`;
  run `/reload-skills` or restart the session.
