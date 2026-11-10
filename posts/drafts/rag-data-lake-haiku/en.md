---
title: "Haiku with a mini data lake: what curated RAG gets right, what it costs and what the test does not prove"
lang: en
date: 2026-11-10
tags: [rag, haiku, data-lake, cost, preregistration, agents]
sources: [study-rag-data-lake-haiku]
status: draft
study: rag-data-lake-haiku
---

**Abstract.** We preregistered six confirmatory hypotheses and ran 7,200 calls (120 multiple-choice questions, 5 samples each, majority vote) to test whether Haiku 5.5, given a mini data lake from an open-source project, decides like a larger model given the right context. Five of the six hypotheses were supported after Holm correction; H9 (cost and accuracy against Sonnet with the oracle) was not (p = 0.08). The curated-memory arm (A5) got 114 of 120 right, against 91 for the whole lake pasted in (A2) and 99 for the best search without curation (A4b), at about 1/300 of A2's nominal cost per correct decision. The main threat to validity is circular: the questions were derived from the same decision cards A5 delivers. For the practical summary, see the [plain-language guide](/en/rag-data-lake-haiku-guia/).

## 1. Question and the decision it informs

It closes H2 of [study 1](/en/haiku-sdd-producao/): does a small model with project memory decide as well as a larger one? The decision at stake is where to invest: a bigger model, long context, or retrieval and curation.

## 2. Material

- **Lake:** 109 documents from the h3 project (commit `f0e17808`) and study 1, with 152 decision cards (107 current, 38 superseded, 7 context) holding decision, reason, when it applies, what it supersedes and sources.
- **Questions:** 120 multiple-choice, 4 options, one always "Insufficient information in the material": 60 ordinary, 30 conflict (old vs current decision) and 30 with no answer. The answer key was written by AI, with a blind review (118 of 120 on the first pass, 120 after fixes) and validation against the gold documents (Haiku, 5 samples: 86 of 90 by vote; the four misses were checked against the sources and the key was kept).
- **Calibration:** 20 extra questions, used only to fix the A6 gate threshold.

## 3. Arms

A0 (question only), A1 (gold documents), A2 (whole lake, ~224k tokens, in the system prompt with caching), A3 (10 chunks by vector), A4a (hybrid BM25 + vector, RRF), A4b (A4a with 30 candidates reranked by bge-reranker-v2-m3), A5 (A4b plus 3 cards, with the superseding decision attached when a card is superseded and chunks tagged with their status), A6 (A5 with a gate: abstain without calling the model if the top reranker score is below 1.05). Sonnet 5.5 on A0 and A1. Controls: N1 (10 irrelevant chunks), N1b (N1 then the gold), N2 (gold then 3 chunks of superseded decisions). All through `claude -p`, no tools, 5 samples, harness-default temperature. Parameters, hypotheses and criteria were fixed before the run (tag `prereg-rag-data-lake-haiku`) and the data frozen after it (`dados-rag-data-lake-haiku`).

## 4. Results

| Arm | Correct/120 | Ordinary | Conflict | No answer | Nominal US$ per correct decision |
|---|---|---|---|---|---|
| A0 Haiku | 43 | 9/60 | 4/30 | 30/30 | 0.00096 |
| A1 Haiku (90) | 86/90 | 57/60 | 29/30 | n/a | 0.00154 |
| A2 whole lake | 91 | 42/60 | 19/30 | 30/30 | 0.295 |
| A3 vector | 84 | 32/60 | 22/30 | 30/30 | 0.00114 |
| A4a hybrid | 88 | 38/60 | 20/30 | 30/30 | 0.00111 |
| A4b + reranker | 99 | 44/60 | 25/30 | 30/30 | 0.00096 |
| **A5 curated** | **114** | 54/60 | 30/30 | 30/30 | **0.00092** |
| A6 gated | 78 | 30/60 | 18/30 | 30/30 | 0.00059 |
| N1 noise | 31 | 0/60 | 1/30 | 30/30 | 0.00292 |
| N1b noise + gold (90) | 86/90 | 57/60 | 29/30 | n/a | 0.00202 |
| N2 gold + superseded (90) | 87/90 | 59/60 | 28/30 | n/a | 0.00168 |
| A0 Sonnet | 62 | 22/60 | 13/30 | 27/30 | 0.0114 |
| A1 Sonnet (90) | 90/90 | 60/60 | 30/30 | n/a | 0.0286 |

Nominal cost = tokens × measured cold list price (Haiku US$ 0.20 and 0.50 per million input and output, US$ 1.00 input above 125k tokens; Sonnet US$ 4 and 10). Real spend with caching is reported separately: A2 averaged US$ 0.012 per call against US$ 0.224 nominal. List-price dollars are not the subscription bill.

**Confirmatory hypotheses (one-sided question bootstrap, 10,000 replicates, Holm across 6):**

| | Criterion | Estimate | Result |
|---|---|---|---|
| H1 | A1 beats A0 by ≥ 25 pp | +81 pp (95% CI 72 to 89) | supported |
| H2 | Haiku A1 within 10 pp of Sonnet A1 | −4.4 pp (95% CI −8.9 to −1.1) | supported (Holm p 0.015) |
| H3 | best RAG recovers ≥ 80% of the oracle gain | 97% | supported |
| H9 | best Haiku RAG ≥ 90% of Sonnet with oracle at ≤ 50% of cost per correct | accuracy and cost favourable | **not supported** (p = 0.08) |
| H10a | A5 at ≤ 25% of A2's cost per correct, losing no more than 10 pp | A5 +19 pp at ~1/300 of the cost | supported |
| H10b | A5 cheaper per correct than A3, 95% CI below zero | −US$ 0.0002 (95% CI −0.00037 to −0.00009) | supported |

Sensitivity without the 15 pilot questions: same conclusions (A5 99/105; H9 p = 0.14).

**Exploratory (no multiple-testing correction).** The reranker improved retrieval a lot (gold excerpt among the top 10: 79% vs 66% for RRF). The A6 gate lowered accuracy (78 vs 114): it abstains on answerable questions, and gains nothing on no-answer ones, which were already 30/30 without it.

## 5. Threats to validity

- **Question circularity (construct).** The 90 answerable questions were derived from cards, and the source card was among those A5 delivered in 79 of them (88%). A5's gain over A4b (+15 points) is therefore a ceiling, not an estimate for questions that did not come from the cards. The A4b result and the arms without cards do not have this problem.
- **AI authorship.** Lake, questions, answer key and review came from the same model family that runs the arms; shared blind spots are possible.
- **"No answer" is easy without material.** With no material, "Insufficient information" is correct on all 30 no-answer questions, which is why A0 scores 30/30 there. The most informative comparisons use the 90 answerable questions.
- **One project, multiple choice, 120 questions.** Power detects about 14 pp overall and 25 pp per block of 30.
- **Parameters chosen on a 15-question pilot**, which remain in the bank (with the sensitivity above).
- **Uncontrolled temperature** and **A2 in the system prompt** (needed for caching) while the other arms use the user message.
- **Cache weight on the subscription:** the documentation does not publish it. After the full run, weekly subscription usage read 21%, but that includes the rest of the session and does not isolate the cache effect.

## 6. What this supports

Safely: giving Haiku only the question is worse than chance on answerable questions; pasting the whole lake costs hundreds of times more than retrieving and scores lower; reranking candidates with a multilingual reranker is the largest single retrieval gain; irrelevant chunks alone are worse than nothing; an abstention gate calibrated on 20 questions did not hold up. Not safely: how much of the curation advantage survives questions that were not born from the cards, and whether the result repeats on another project or model. The natural next step is a question bank written by someone else, without access to the cards.

## 7. Reproducibility

Code in `tools/rag-lake/`, questions, answer key and lake in `studies/rag-data-lake-haiku/`, raw data in `dados/bruto/` with a hash manifest. Tags `prereg-rag-data-lake-haiku` and `dados-rag-data-lake-haiku`. Analysis command: `python tools/rag-lake/analisar.py dados/bruto/*.jsonl --replicas 10000`.
