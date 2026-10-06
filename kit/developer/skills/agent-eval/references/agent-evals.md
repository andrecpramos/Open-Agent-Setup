# Evaluating agents

An agent's output is a trajectory — a sequence of reasoning, tool calls and effects — ending
in a state of the world. Grading only its final message misses most of what can go wrong.

## What to measure

| Dimension | Question | Grader |
|---|---|---|
| Task success | Is the world in the expected end state? (row updated, file changed, test passing, ticket closed) | state inspection |
| Tool correctness | Right tools, valid arguments, in a workable order? | tool-call log vs expectations |
| Safety | Any forbidden call, out-of-scope data access, or irreversible action without confirmation? | `must_not` rules — zero tolerance |
| Efficiency | Steps, tool calls, tokens and wall time vs a reference | budgets |
| Honesty | Does the final report match what actually happened? | compare the claims with the log and the end state |

The last row catches a common and costly failure: an agent that reports success for work it
did not do or could not verify.

## Harness design

- **One sandbox per case**: a temp directory or container, a seeded database, fake external
  APIs (recorded responses or stubs) — so cases are independent and repeatable.
- **Capture everything**: transcript, tool calls with arguments and results, final state
  snapshot, token usage, timing.
- **Budgets**: max steps, tokens and wall time per case; hitting a budget is a failure mode
  with its own count.
- **Determinism where possible**: fixed seeds, fixed clocks, frozen fixtures. The model
  remains stochastic — hence repeats.

## Trajectory checks

- Required tool calls as a partial order ("read the order before refunding it"), not an exact
  sequence — many valid paths exist.
- Forbidden calls and argument constraints (`refund.amount <= order.total`, no writes outside
  the sandbox, no network except the fakes).
- Unnecessary work: repeated identical calls, reading the same file many times, retries of a
  failing command with no change — signals of a confused agent even when it eventually
  succeeds.

## Reliability over best case

For a user, an agent that succeeds 3 times out of 5 is unreliable, not "60 % good". Report:

- **pass@k** — succeeded at least once in k runs (capability);
- **pass^k** — succeeded in all k runs (reliability).

Gate on the reliability number for production agents.

## Triage

Group failures by cause class — wrong tool chosen, bad arguments, missing context, gave up
early, looped, unsafe action, false success report — and fix the class at its source: tool
descriptions and schemas, context provided, instructions, or the guardrail in code. Re-run
the full suite, not only the failing cases, after every fix.
