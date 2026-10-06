<!-- agent-setup:begin -->
<!-- Managed by agent-setup v{{KIT_VERSION}}. `agent-setup update` rewrites this block. -->
@./AGENTS.md

## Gemini CLI

- Skills live in `.agents/skills/`, the Agent Skills folder Gemini CLI reads — the one copy of
  every skill in this repository.
- Gemini CLI runs none of the kit's hooks (its successor, Antigravity, runs the git guard): the
  branching contract is instructions here, backed by branch protection on the git host where it
  is set. Follow it exactly.
<!-- agent-setup:end -->
