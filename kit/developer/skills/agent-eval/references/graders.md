# Graders

## Contents

1. Choosing a grader
2. Code-based graders
3. LLM-as-judge
4. Pairwise comparison
5. Calibration
6. Human review

## 1 · Choosing a grader

Use the cheapest grader that is reliable for the criterion:

| Criterion | Grader |
|---|---|
| Exact label, classification, routing decision | exact match |
| Structured output | JSON-schema validation + field checks |
| Numbers | tolerance comparison, computed independently |
| Code generation | run the tests (pass@k); lint/typecheck |
| SQL generation | execute against a fixture DB and compare result sets |
| Agent actions | inspect the end state and the tool-call log |
| Facts present / absent | string or regex checks on normalised text, or a judge for paraphrase |
| Tone, helpfulness, faithfulness to sources | LLM judge with a rubric, calibrated |
| Anything contested | human review |

## 2 · Code-based graders

Deterministic, fast, free — and brittle only if you check surface form instead of meaning.
Normalise (case, whitespace, number formats) before comparing; check fields of structured
output rather than whole strings; for free text, check for required facts and forbidden
claims rather than an exact answer.

## 3 · LLM-as-judge

A judge prompt that works:

```text
You are grading a support assistant's reply against a rubric.

<conversation>{{input}}</conversation>
<reply>{{output}}</reply>
<reference>{{reference_answer_or_facts}}</reference>

For each criterion, answer PASS or FAIL and quote the evidence from the reply.
1. correct_action — the reply asks a clarifying question instead of issuing a refund.
2. no_fabrication — every order number, amount and date in the reply appears in the conversation or reference.
3. policy — the reply does not promise anything outside the refund policy in the reference.

Return JSON: {"correct_action": {"verdict": "PASS|FAIL", "evidence": "..."}, ...}
```

Rules:

- **Binary or three-point criteria**, each about one thing. A 1–10 "quality" score is noise.
- **Reference answers or required facts** in the prompt; a judge without a reference grades
  plausibility.
- **Evidence quotes** required — they make verdicts auditable and reduce hallucinated passes.
- **Structured output** for the verdict; parse it strictly; count unparseable verdicts as
  failures of the harness, not passes.
- Judge model at least as capable as the system under test; a different model family reduces
  self-preference bias.
- Temperature 0 and a fixed judge prompt version — the judge is part of the harness and is
  versioned like one.

## 4 · Pairwise comparison

For "is B better than A?", show the judge both outputs **twice with the order swapped**; count
a win only when both orderings agree, otherwise a tie. Position bias is large and
consistent; a single ordering measures it rather than quality. Also control for length —
judges prefer longer answers.

## 5 · Calibration

Before trusting a judge on a criterion:

1. Humans label 30–50 cases for that criterion (two labellers where it is subjective).
2. Run the judge; measure agreement with the human labels (percent agreement, and Cohen's
   kappa if classes are imbalanced).
3. Read every disagreement; fix the rubric wording or add a reference; repeat.
4. Aim for agreement comparable to human–human agreement (often ≥ 0.8). Record the number in
   the suite's README and re-check when the judge prompt or model changes.

## 6 · Human review

For subjective quality and for auditing the automated graders: sample outputs per bucket,
review blind to which version produced them, record structured feedback, and turn recurring
comments into new criteria or cases.
