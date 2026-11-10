---
title: "Give Haiku the project's memory, not the whole project"
lang: en
date: 2026-11-10
tags: [rag, haiku, guide, cost, agents]
sources: [study-rag-data-lake-haiku]
status: draft
study: rag-data-lake-haiku
---

**Plain-language version of the "Haiku with a mini data lake" study.** For the full scientific write-up, read the [technical article](/en/rag-data-lake-haiku/). This page is what it means if you want to use it tomorrow.

## In one sentence

A small model, Haiku, **with no project material answers only about 1 in 7 decisions** that depend on the project's history. With a **curated project memory** (document excerpts plus decision cards, marked with which decisions were superseded), it got **114 of 120 questions right at less than 1/200 of the cost of pasting the whole project into the prompt**. The key caveat is further down: the questions came from the same cards the memory delivers.

## What we tested

We built a "mini data lake" from the open-source project h3: 109 documents (code, issues, docs and the previous study) and 152 decision cards, each with the decision, the reason, when it applies and whether another decision superseded it. We wrote **120 multiple-choice questions** about project decisions (60 ordinary, 30 with an old and a current decision, 30 with no answer in the material). Each question was answered **5 times** under each way of giving Haiku context, for **7,200 calls** in total, with no failures.

## What we found

| How Haiku got its context | Correct of 120 | Cost per correct decision* |
|---|---|---|
| Question only | 43 (36%) | US$ 0.001 |
| Whole project pasted in the prompt | 91 (76%) | **US$ 0.295** |
| Simple chunk search | 84 (70%) | US$ 0.0011 |
| Better search (hybrid + reranking) | 99 (83%) | US$ 0.0010 |
| **Curated memory (chunks + cards + superseded decisions)** | **114 (95%)** | **US$ 0.0009** |
| Right documents handed over (upper bound) | 86 of 90 (96%) | US$ 0.0015 |

*List price with no cache, per correct call. On the subscription the real spend was lower.

**1. Pasting everything is expensive and not the best.** The whole project is about 224k tokens. Pasting it for every question cost, at list price, **over 300 times** the curated memory, and scored lower (76% vs 95%).

**2. The curated memory came close to the ceiling.** On the 90 questions that have an answer in the material, it got 84 right (93%); handing over the right documents got 86 (96%).

**3. Haiku with the right context came close to Sonnet.** With the right documents, Haiku got 86 of 90 and Sonnet 90 of 90, a gap of about 4 points.

**4. Noise and old decisions hurt less than expected here.** Mixing irrelevant chunks or superseded decisions into the right material changed accuracy little (86 and 87 of 90 vs 86). Irrelevant chunks alone dropped Haiku to 26%, below giving it nothing.

## Where we did not confirm

- **The "abstention gate" made things worse.** The idea was for the system to answer "not enough information" without calling the model when retrieval found nothing good. It abstains too often: 78 correct of 120. Do not use it as is.
- **Cost against Sonnet with the right documents.** We expected Haiku with the best search to reach 90% of Sonnet's accuracy with the right documents at under half the cost. Cost came in far below, but the statistical evidence for the accuracy part did not meet our criterion (p = 0.08 after correction).

## The caveat that changes how to read this

**The questions were written from the same decision cards the curated memory delivers.** In 79 of the 90 answerable questions, the source card was among the 3 cards delivered. In a real project your questions do not come from your cards. So the jump from 83% to 95% over the better search is a **ceiling**, not a forecast. What remains safe to say: searching well (hybrid plus reranking) already beats pasting everything, and delivering a few excerpts costs hundreds of times less.

## The practical recipe

1. **Do not paste the whole project.** More context is not more accuracy.
2. **Search by chunks, combining keywords and meaning, and rerank** candidates before building the prompt.
3. **Write decision cards** (decision, reason, when it applies, what it supersedes) and **mark what was superseded**.
4. **Allow an "insufficient information" answer**, but do not automate abstention without testing it.
5. **Measure with questions you did not write from your own cards.**

## What is out of scope

One project, 120 multiple-choice questions, an answer key written and reviewed by AI from the same family as the models tested. Open-ended questions, other projects and other models are left for other studies. Data and code are in the [study repository](/en/rag-data-lake-haiku/).
