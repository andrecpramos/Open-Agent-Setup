# ADR-{{NNN}} — {{Title: the decision, not the problem}}

**Status:** {{Proposed | Accepted | Superseded by ADR-NNN | Deprecated}}
**Date:** {{YYYY-MM-DD}}
**Deciders:** {{who made the call — for a one-way door, the user, by name}}
**Supersedes:** {{ADR-NNN, or —}}
**Rules affected:** {{Rule N from .agents/docs/rules.md, or —}}

> Title rule: name the choice, not the topic. "ADR-004 — Confirm writes, never reads" is
> findable. "ADR-004 — Action policy" is not.

## Context

{{The forces. What is true that makes this decision necessary now, which constraints apply,
and what happens if nothing is decided. Write for a reader two years from now who was not in
the room — they are the entire audience.

Include the measurements and the arithmetic. "It was too slow" ages into an unfalsifiable
claim; "p95 was 4.2 s against a 2 s budget, measured on {{environment}} on {{date}}" stays
useful. Mark numbers you do not have as unknown.}}

### Quality-attribute scenarios

| Attribute | Scenario | Measure |
|---|---|---|
| {{performance}} | {{source, stimulus, environment}} | {{response measure}} |

## Decision

{{One paragraph, active voice, stated as something the project now does: "We will …". If it
has not been decided yet the status is Proposed — the sentence is still declarative.}}

## Alternatives considered

Each alternative gets an honest hearing. One dismissed in half a sentence reads as one that
was never considered, and it will be proposed again.

### {{Alternative A}}

**What it is.** {{…}}
**Why not.** {{The specific disqualifying property. "Too complex" is not a reason; "requires
a coordinated migration across three services" is.}}

### {{Alternative B}}

**What it is.** {{…}}
**Why not.** {{…}}

### Do nothing

{{Always considered explicitly. Sometimes it wins, and it is the only option guaranteed to
be available.}}

## Consequences

### Positive

- {{What this makes possible or cheap}}

### Negative

- {{What this makes harder, slower or more expensive}}

**This subsection is the point of the document.** An ADR with no negative consequences is
advocacy. Every real choice costs something, and the person who lives with the cost deserves
the warning.

### Neutral

- {{Changes that are neither better nor worse — new conventions, moved responsibilities,
  things a future reader will find surprising}}

## Reversibility

**Cost to reverse:** {{low | medium | high}}
**What reversing would require:** {{concretely — files, migrations, coordination}}

## Compliance

**Enforced by:** {{a gate id from .agents/sdlc.config.json, an architecture test, a hook — or
**convention**}}

If `convention`, add a row to the gap list in `.agents/docs/critical-infrastructure.md`. An
unenforced ADR is a strong suggestion, and calling it binding does not make it so.

## Notes

{{Links to the discussion, the spike, the benchmark, the incident.}}
