# Scorecards

The kit's eval results, one file per suite and state. Written by the CLI only — never by hand.

| File | Written by | Means |
|---|---|---|
| `<suite>.latest.json` | `agent-setup eval-routing --save`, `agent-setup eval-outcomes --save` | the newest run, merged bucket by bucket |
| `<suite>.baseline.json` | `agent-setup evals --promote` (moves the latest) | the accepted result CI compares against |

Suites: `routing` and `trigger` (which skill or agent a real agent picks for a prompt), and
`outcome` (the kit against vanilla on the same cases, graded blind).

## Only like with like

Every scorecard records the measurement `method` (`EVAL_METHOD` in `src/lib/routing.mts`) and
the `model` it ran on. Whenever how a run is measured changes — the scratch project and where
its skills sit, what counts as an activation, the verdict rules, the grader prompt — the method
number goes up. Then:

- a new run never merges buckets from a scorecard of another method or model: it starts fresh
  and says so;
- `agent-setup evals` does not compare a latest with a baseline of another method or model: it
  reports "not comparable" instead of a regression, and `--check` passes. Review the new
  numbers, then `--promote` them as the baseline.

No baseline is committed yet: the first full pass on the current method sets it —
`agent-setup eval-routing --suite all --save`, then `agent-setup evals --promote`.
