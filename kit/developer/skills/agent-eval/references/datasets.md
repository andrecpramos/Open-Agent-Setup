# Datasets

## Contents

1. Buckets
2. Case format
3. Where cases come from
4. How many cases
5. Splits, versions and hygiene

## 1 · Buckets

Balance the dataset across the ways the system can fail, not the ways it usually succeeds.
A starting mix (adapt the shares; write down why):

| Bucket | Share | Must produce |
|---|---|---|
| Happy / direct | 20 % | the correct result |
| Paraphrase / near-miss | 30 % | the correct result despite different wording, typos, other languages the product supports |
| Ambiguous | 15 % | a clarifying question, not a guess |
| Multi-step / contextual | 10 % | the right result using conversation or retrieved context |
| Out of scope | 10 % | an honest refusal or hand-off |
| Adversarial | 10 % | **zero** unsafe or destructive outcomes — prompt injection, policy evasion, data exfiltration attempts |
| Edge / locale | 5 % | correct handling of empty, huge, malformed, multilingual, date/number formats |

A corpus that drifts toward happy paths stops detecting the failures that matter — and does
so silently, because the score goes up.

## 2 · Case format

JSONL, one case per line, versioned in the repo:

```json
{"id": "refund-017", "bucket": "ambiguous", "input": {"message": "I want my money back"}, "expected": {"action": "ask_clarification"}, "must_not": ["refund"], "source": "prod-2026-08 ticket 4411 (scrubbed)", "added": "2026-09-02", "tags": ["refunds"]}
```

- `expected` holds what a grader can check: a label, a reference answer, required facts, a
  target end state.
- `must_not` lists outcomes that are failures regardless of anything else.
- `source` and `added` let you trace why a case exists and when; a case added after an
  incident links to it.

## 3 · Where cases come from

1. **Production traffic** — sampled across segments (not just the most frequent), scrubbed of
   personal data, labelled.
2. **Failures** — every bug report, support escalation and regression becomes a case the day
   it is found. A bug is not fixed until it is a permanent case.
3. **Synthetic variation** — an LLM paraphrases or perturbs real cases; a human reviews every
   generated case before it enters the set (generated labels are wrong more often than
   generated inputs).
4. **Red-teaming** — deliberate adversarial attempts for the adversarial bucket: injected
   instructions in documents, tool results and user fields; requests for other users' data;
   attempts to exceed limits.

## 4 · How many cases

Rough 95 % confidence half-width for a pass rate `p` on `n` independent cases:
`1.96 × sqrt(p(1−p)/n)`.

| n | p = 0.8 | p = 0.95 |
|---|---|---|
| 20 | ±18 pts | ±10 pts |
| 50 | ±11 pts | ±6 pts |
| 200 | ±6 pts | ±3 pts |

So a 3-point change on 50 cases is noise. Size each important bucket for the smallest change
you need to detect, and report the number of cases and runs next to every score.

## 5 · Splits, versions and hygiene

- **Held-out split** — tune prompts on a dev split, report on a test split you don't look at
  while tuning; refresh it from new production cases.
- **Version the dataset**; a scorecard names the dataset version it ran on.
- **No personal data** in committed cases — replace names, emails, ids and free text that
  identifies people.
- **Labels**: two labellers for subjective cases, adjudicate disagreements, and write the
  labelling guideline down — it becomes the judge rubric later.
