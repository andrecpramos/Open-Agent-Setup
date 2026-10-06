---
name: architecture
description: >
  Make, review and record structural decisions — module and service boundaries, layering and
  dependency rules, data ownership, sync vs async communication, monolith vs services, build
  vs buy, adopting a framework, database, queue or infrastructure component, scalability and
  resilience trade-offs — and write Architecture Decision Records (ADRs). Use whenever someone
  asks "how should we structure…", "where should this live?", "should we split, extract or
  introduce X?", "is X worth it for our team?", proposes a new service, queue (Kafka,
  RabbitMQ), database or major dependency, asks to review an RFC or design doc, draw a
  container or C4 diagram, enforce import boundaries with a lint rule, or untangle a framework
  or ORM leaking into the domain layer, or when a change crosses more than one module or layer
  — even if they never say "architecture", and even for a quick opinion. Not for the internals
  of one endpoint (api-design) or one query (backend).
---

# Architecture

Architecture is the set of decisions that are expensive to reverse. The job is not to pick the
most sophisticated option; it is to make those decisions deliberately — forces named,
alternatives weighed honestly, costs written down — and then to make them *enforceable*,
because an architecture that lives only in a document erodes one convenient import at a time.

## Before you start

1. **Read the overlay.** `.agents/overlays/architecture.md`, if it exists, is this project's
   adaptation of this skill and wins where they disagree.
2. **Read what is already decided.** ADRs in `.agents/decisions/` (or the project's ADR
   folder) are binding; `.agents/docs/architecture.md` and `.agents/docs/rules.md` describe the
   layers and invariants. A proposal that contradicts an accepted ADR must supersede it
   explicitly, never quietly.
3. **Survey reality, not intent.** Derive the actual dependency graph from imports, who
   writes which tables, the deployable units and runtime dependencies
   ([references/boundaries.md](references/boundaries.md) has the commands per ecosystem).
   Where the documents and the code disagree, the code is the truth and the disagreement is a
   finding.

## Workflow A — make a decision

1. **Frame it.** One sentence for the question. Then the forces: the quality attributes that
   matter, as scenarios with numbers where they are known ("p95 under 300 ms at 200 rps", "a
   new payment provider in under two days", "tenant data never co-mingled"), the constraints
   (team size and skills, budget, compliance, deadline), and what happens if nothing is
   decided. Mark unknown numbers as unknown — an invented threshold becomes a cited fact.
2. **Apply the reversibility test.** If undoing it later means touching more than one layer,
   a coordinated migration, or something users depend on, it needs an ADR now. If it is
   cheap to reverse, decide quickly, note it in the PR, and move on.
3. **Generate real options** — at least two, plus "do nothing / smallest change". An option
   dismissed in half a sentence was never considered, and it will be proposed again.
4. **Evaluate against the forces** in a table: fit to each scenario, cost of change,
   operational burden (who runs it at 3 a.m.), failure modes, team familiarity, lock-in, and
   what it makes harder later. [references/decision-toolkit.md](references/decision-toolkit.md)
5. **Recommend, with the negative consequences stated.** A one-way door is the user's call:
   present the recommendation and wait, rather than implementing it as a side effect.
6. **Record it** as an ADR — from the project's `.agents/decisions/ADR-000-template.md` if it
   has one, otherwise from the kit's
   [ADR template](../sdlc-init/assets/templates/decisions/ADR-000-template.md): next number,
   a title that names the decision, the index updated.
7. **Make it enforceable.** Name the fitness function that fails when the decision is
   violated — a dependency rule, an architecture test, a gate in `.agents/sdlc.config.json`.
   If none exists yet, the ADR's Compliance section says **convention** and the gap goes on the
   register.

## Workflow B — review a design or a change

1. **Scope** — which modules, layers and services does it touch?
2. **Dependency rule** — does any inner module now import an outer one (domain → framework,
   core → feature, service → another service's internals)? Count the violations.
3. **Data ownership** — does a module write another module's tables or read its internals?
4. **Failure paths** — for each new dependency: slow, down, wrong, malicious. What happens?
5. **The second-X test** — what would a second tenant, provider, client or region have to
   change in the core to use this? Anything other than "nothing" or "one registration" is
   coupling.
6. **Report** findings with evidence and the smallest fix; flag decisions that were made
   implicitly and deserve an ADR; recommend a gate for every boundary nothing enforces.
   [references/review-checklist.md](references/review-checklist.md)

## Heuristics that usually hold

- **Modular monolith first.** Extract a service for a reason that survives scrutiny —
  measured independent scaling, a different owning team, a different release cadence, a hard
  isolation requirement. "Microservices are best practice" is not a reason.
- **Boundaries follow business capabilities and data ownership**, not technical layers.
- **Dependencies point inward.** The domain defines ports; adapters implement them; the
  composition root is the only place that knows everything.
- **One writer per piece of data.** A database shared by services makes a distributed monolith.
- **Choose sync or async per interaction.** Synchronous calls couple availability;
  asynchronous messaging couples you to eventual consistency and harder debugging.
- **Design the failure path first** — missing, slow, wrong and malicious are the normal cases.
- **Prefer boring technology the team already runs.** Every new component adds on-call load,
  upgrades and security surface.
- **Abstract for change you can predict, not change you imagine.** An interface with one
  implementation "for flexibility" is a cost with no measured benefit.

## Anti-patterns to name when you see them

Distributed monolith (services that must deploy together or share a database) · `common`,
`shared` or `utils` modules everything imports · ORM entities or vendor types crossing
boundaries · cyclic dependencies between modules · big-bang rewrites · a cache or search
index treated as the source of truth · events everywhere with no tracing · configuration-driven
"frameworks" where plain code would be clearer · generalisation before the second use case.

## Diagrams

C4 context and container views cover most needs; draw components only for the part under
discussion. Use Mermaid or ASCII inside Markdown so diagrams live in the diff and go stale
visibly. Show the direction of dependency, mark the boundaries a gate enforces, and draw the
main failure sequence — not only the happy path.

## Done means

- **Decision:** question, forces, at least two options plus do-nothing, evaluation,
  recommendation with its downsides, reversibility — an ADR when the test says so, with its
  enforcement named or its gap recorded.
- **Review:** findings with file:line evidence and counts, each with a smallest fix;
  implicit decisions flagged for ADRs.
- `.agents/docs/architecture.md` updated if the structure changed.

A boundary this repo cares about that nothing enforces is a lesson worth capturing in
`.agents/learnings/inbox.md` — the retro turns it into a gate.
