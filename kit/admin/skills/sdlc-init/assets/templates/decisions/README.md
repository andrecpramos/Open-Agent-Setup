# Architecture Decision Records

The constitution. Where an ADR and any other document disagree, **the ADR wins**
and the disagreement is a bug.

## The rules

**1 · Numbered sequentially, never reused.** `ADR-001`, `ADR-002`, … Numbers are
cited in commit messages, code comments and PR reviews; reusing one breaks every
reference at once.

**2 · Never deleted, never edited after acceptance.** A decision that turns out to
be wrong is **superseded** by a new ADR, and the old one gets a forward pointer.
The record of a wrong decision and why it was reversed is more valuable than the
decision itself — it is the only thing that stops the same choice being made again
in eighteen months by someone who wasn't there.

**3 · Status is a small closed set.**

| Status | Meaning |
|---|---|
| `Proposed` | Written, not yet decided |
| `Accepted` | Binding |
| `Superseded by ADR-NNN` | No longer binding; the pointer is mandatory |
| `Deprecated` | No longer applies, nothing replaced it (say why) |

**4 · One decision per ADR.** An ADR covering three choices cannot be superseded
partially, and one of the three always needs revisiting first.

## When one is required

The **reversibility test**: if undoing this choice later means touching more than
one layer, coordinating a migration, or changing something users depend on — it
needs an ADR now.

In practice:

- A dependency that will spread across layers
- A change to a layer boundary or the dependency rule
- A storage engine, a wire format, a runtime
- A policy table — anything encoding "what is allowed to happen"
- Anything that weakens a principle stated in [project.md](../docs/project.md) or [rules.md](../docs/rules.md)
- Anything a reasonable person would later ask *"why on earth is it like this?"* about

**The cheap test:** if you find yourself writing a long comment explaining why the
obvious approach was not taken, that comment wants to be an ADR.

## When one is *not* required

Reversible choices. A library that touches one module, a naming convention, a
refactor that changes no interface. Writing ADRs for these dilutes the set until
nobody reads any of them, which costs more than the missing records.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-001]({{path}}) | {{...}} | {{Accepted}} | {{DATE}} |

> Keep this table current. An index that is missing the last four ADRs teaches
> readers to skip the index and grep the directory, and then to skip the directory.

## Writing one

Copy [ADR-000-template.md](ADR-000-template.md). The `architecture` skill walks through
it — the forces, the options including "do nothing", the reversibility test, and the
enforcement that makes the decision real.

The section that carries the value is **Consequences**, specifically the negative
ones. An ADR listing only benefits is advocacy, and it will not help the person
who has to live with the decision.
