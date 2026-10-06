---
name: agent-eval
description: >
  Design, run and gate evaluations for anything driven by an LLM — prompts, agents and
  tool-calling flows, RAG pipelines, classifiers and routers, and Claude Code skills or
  AGENTS.md/CLAUDE.md instructions. Covers success criteria, bucketed golden datasets,
  graders (code checks, LLM-as-judge rubrics, human review), baselines, variance, cost and
  latency, regression gates on a committed scorecard, and prompt versioning. Use whenever
  someone changes a prompt, model or agent instruction, asks "is the new prompt better?",
  "why did the agent do that?" or "the bot got worse", wants evals, a benchmark or a
  scorecard, or is creating or improving a skill — even if they never say "eval".
---

# Evaluating LLM systems

Without an evaluation, a prompt change is a guess and a model upgrade is a gamble. Manual
spot-checks over-sample the inputs you happened to think of — which are exactly the ones the
system already handles. An eval turns "seems better" into a number per bucket that can be
compared, committed and gated.

## Before you start

1. **Read the overlay.** `.agents/overlays/agent-eval.md`, if it exists, is this project's
   adaptation of this skill and wins where they disagree.
2. **Find what exists**: eval scripts, datasets (`evals/`, `fixtures/`, `corpus/`), committed
   scorecards, prompt files and their versions, model configuration, and the corpus section of
   `.agents/docs/testing.md`. Extend what is there before inventing a new harness.
3. **Name the unit under test** — a single prompt (input → output), a pipeline (retrieval +
   generation), an agent (multi-step, tools, side effects), or instructions for a coding agent
   (a skill, AGENTS.md). The graders differ for each.

## Workflow

1. **Write success criteria per task, including what must never happen.** "Correct intent for
   supported requests; a clarifying question when ambiguous; an honest refusal when out of
   scope; zero destructive tool calls on adversarial input."
2. **Build the dataset in buckets** — happy path, paraphrase/near-miss, ambiguous,
   out-of-scope, adversarial, edge/locale — balanced so no bucket dominates. Start with 20–50
   real cases; real logs beat synthetic data (scrub personal data); every production failure
   becomes a permanent case. [references/datasets.md](references/datasets.md)
3. **Choose graders, cheapest reliable first:** exact or structural checks in code → schema
   validation → checks on state and side effects → LLM-as-judge with an explicit rubric and
   reference answers, calibrated against human labels → human review for what remains
   subjective. [references/graders.md](references/graders.md)
4. **Establish the baseline** — run the current version first and commit its scorecard.
5. **Run the candidate** with the same settings and repeats (≥ 3 for anything stochastic),
   sequentially when timing matters; record pass rate per bucket, latency (p50/p95) and cost.
6. **Compare per bucket, not only overall** — an overall gain can hide a safety regression:
   `node .agents/skills/agent-eval/scripts/compare-scorecards.mjs baseline.json candidate.json`
7. **Read the failures, not just the numbers.** Cluster them, fix the cause (prompt, retrieval,
   tool design, output schema), change one thing at a time, re-run.
8. **Gate it.** Commit the scorecard; CI compares the candidate against the baseline with a
   tolerance; safety buckets gate at zero.

## Agents and tool use

Grade the trajectory and the end state, not only the final message: the right tools with
valid arguments, no unnecessary or unsafe calls, the database row / file / ticket actually in
the expected state, and steps, tokens and cost within budget. Run each case in a sandbox with
fakes for external systems. For agents, reliability matters more than best-case: prefer
"passes all k runs" over "passes at least once in k". [references/agent-evals.md](references/agent-evals.md)

## Skills and agent instructions

Two evaluations: **triggering** (does the description load the skill for the right requests
and not for near-misses?) and **outcome** (with vs without the skill, or old vs new, graded
by expectations). Kit skills keep both in `evals/evals.json` and `evals/trigger.json`, in the
formats the skill-creator skill's eval tools read. [references/skill-evals.md](references/skill-evals.md)

## The mistakes that matter

- **Tuning against a handful of manual tries.** It optimises for the phrasings you think of.
- **One overall number.** Buckets show *where* it broke; the overall hides it.
- **Vague judges** — "rate 1–10 how good" is noisy and biased toward length, position and the
  judge's own style. Use binary or three-point criteria with a rubric, reference answers,
  evidence quotes, and pairwise comparison with the order swapped.
- **Non-discriminating checks** that pass for baseline and candidate alike measure nothing —
  replace them with checks that failed at least once.
- **One run of a stochastic system**, and a two-point "win" declared from it. With 50 cases
  the 95 % interval on a pass rate is roughly ±10 points — size the dataset to the delta you
  need to see.
- **Absolute thresholds as gates** ("≥ 90 %") — they block everything or nothing. Gate on
  the comparison with the committed baseline, plus zero tolerance where safety is involved.
- **A corpus drifting toward easy cases** — the score rises as the test gets easier.
- **Evaluating on the data you tuned on.** Keep a held-out split.
- **Parsing free-form output.** Use structured outputs or tool schemas, and validate them.
- **Editing a shipped prompt in place.** Prompts are versioned files paired with a model
  version; a change creates the next version so the diff and the scorecard line up.
- **Assuming results transfer between models.** A prompt tuned on a large model is
  re-validated on the small one it will actually run on — and on every model upgrade.

## Scorecard format

```json
{
  "suite": "support-intents",
  "candidate": "prompt-v8 + claude-sonnet-5",
  "date": "2026-09-26",
  "runs": 3,
  "buckets": {
    "happy": { "passed": 58, "total": 60 },
    "ambiguous": { "passed": 17, "total": 20 },
    "adversarial": { "passed": 30, "total": 30, "zeroTolerance": true }
  },
  "metrics": { "latency_p95_ms": 2400, "cost_usd_per_100": 0.84 }
}
```

`passed` and `total` count trials — cases × runs — so 20 cases run 3 times is `total: 60`.

`compare-scorecards.mjs` exits 1 when a bucket drops by more than its allowed drop — the larger
of `--tolerance` (default 0.02) and the sampling noise (`--z`, default 1.645 × the standard
error of the difference) — when a bucket disappears, or when a zero-tolerance bucket has any
failure. A drop inside the noise prints as `noise`: a lead to read, not a verdict. It warns
when bucket sizes changed, because then the comparison is between different tests.

## Done means

- Success criteria written down; dataset committed with buckets and sources; graders defined
  and — for judges — calibrated.
- Baseline and candidate scorecards committed; the comparison reported per bucket with the
  number of runs; the failures read and summarised by cause.
- The regression gate wired into CI (or the gap recorded in the project's register).

A failure mode you found by reading transcripts is the most valuable output of an eval: add
it as a permanent case, and note the lesson in `.agents/learnings/inbox.md`.
