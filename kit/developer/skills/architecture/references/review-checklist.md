# Architecture review checklist

Use for a design document, an RFC, or a PR that crosses module boundaries. Answer each with
evidence; "n/a" is fine when it is true.

## Fit

- [ ] What problem does this solve, and which forces (scenarios) drive the design?
- [ ] Is it consistent with accepted ADRs? If not, does it supersede one explicitly?
- [ ] Is this the smallest change that meets the forces? What was the do-nothing option?

## Boundaries

- [ ] Does any inner/core module now depend on an outer one? (count)
- [ ] Does any module reach into another's internals, tables or private types?
- [ ] New cycle between modules?
- [ ] Vendor or framework types crossing into the domain?
- [ ] Is each boundary enforced by a check, or is it a convention?

## Data

- [ ] Who owns (writes) each new or changed piece of data? Exactly one writer?
- [ ] Consistency model stated — transactional, eventual (with how long, and what the user sees meanwhile)?
- [ ] Migration path for existing data; compatibility during rollout?

## Failure

- [ ] Each new dependency: timeout, retry policy, behaviour when down/slow/wrong.
- [ ] Partial failure in multi-step flows: what is left behind, and how is it compensated?
- [ ] Blast radius: can one tenant, request or job exhaust something shared?

## Operability

- [ ] How is it deployed, configured, monitored and rolled back?
- [ ] Who is paged when it breaks, and what do they look at first?
- [ ] New infrastructure: who upgrades and patches it?

## Security

- [ ] New trust boundaries or data flows? (hand over to the `security` skill for depth)
- [ ] Least privilege for new credentials and service identities?

## Evolution

- [ ] The second-X test: what would a second tenant/provider/client/region change in the core?
- [ ] What does this make harder later, and is that written down?
- [ ] Does it need an ADR (reversibility test)? Is one drafted?

## Output

Findings ordered by blast radius, each with evidence (file:line or diagram element), the
smallest fix, and whether it needs an ADR or a gate. End with the single most important
action.
