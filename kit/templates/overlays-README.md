# Skill overlays

A kit skill in `.agents/skills/<name>/` is shared by every project that installs Agent_Setup,
and `agent-setup update` replaces it. This folder is where **this** project adapts a skill
without forking it.

Each skill written for the kit reads `.agents/overlays/<skill-name>.md` before it starts, and
the overlay wins where the two disagree. The two third-party skills (`design-taste-frontend`,
`agent-browser`) are copied verbatim from their authors and read no overlay: say how they
apply here in `.agents/overlays/frontend.md`.

Write only what is specific to this repo and what a competent agent would otherwise get wrong:

```markdown
# frontend — overlay
- Components live in `src/ui/<feature>/`; shared primitives in `src/ui/kit/`. Never create a
  second primitive — widen the existing one.
- Server state is TanStack Query only; query keys come from `src/api/keys.ts`.
- Single test: `pnpm vitest run <file>` · e2e: `pnpm playwright test <spec>`.
```

`/sdlc-init` writes the first overlays from its survey; `/self-improve` adds to them as the
project teaches its agents (both are run by whoever maintains the setup). If an overlay line
would help *every* project, it belongs in the kit instead: note it in
`.agents/learnings/inbox.md` as universal, and the retro exports it upstream.
