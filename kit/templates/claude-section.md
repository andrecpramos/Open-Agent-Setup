## Claude Code

- **Hooks** (`.claude/settings.json`) back this agreement and stay silent until they have
  something to say. When one speaks, act on it: a denied command — take the alternative it
  names, never work around it; a check or a review asked for — run it; an INTAKE note —
  write the brief; a ROUTE note — hand the work to the agent it names; a PR note — open the
  draft PR before your first edit.
{{CLAUDE_AGENTS}}
- **Memory:** personal preferences belong in auto memory or `CLAUDE.local.md`; project facts
  in `.agents/docs/`, where every agent can read them.
- Skills missing in a fresh clone? The session-start hook links them into `.claude/skills/`;
  ask the user to run `/reload-skills` or restart the session.
