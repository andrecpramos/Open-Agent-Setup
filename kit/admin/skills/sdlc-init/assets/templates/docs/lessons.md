# Lessons

> Append-only. Newest last. Each entry is dated and says what happened, what to do instead,
> and — where one exists — the mechanism that now enforces it.

This file is the **weakest** home a lesson can have: it is read only by an agent that goes
looking. The `self-improve` skill routes each lesson to the strongest form it can take — a
guard rule, a gate, a `postEdit` check, a skill overlay, a path-scoped rule — and records it
here when it is background knowledge, or as the incident behind a rule that now lives
somewhere stronger.

## Format

```markdown
### YYYY-MM-DD — <the lesson as a short imperative>
**What happened.** <one to three sentences: the mistake or the surprise, and what it cost>
**Do instead.** <the rule, stated so a violation is recognisable>
**Enforced by.** <gate id / hook / postEdit / overlay / test — or "convention">
```

> **Survey:** at install, harvest the lessons the repo already knows — plan documents,
> post-mortems, "gotchas" sections, and `// never do X` comments
> (`rg -n -i "(never|must not|do not|always) (import|commit|edit|call|use|push|run)"`).
> Each one found is an entry here, and a candidate for the enforcement ladder.

## Entries

{{none yet — the first retro adds them}}
