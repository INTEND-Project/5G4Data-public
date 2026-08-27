# Experimental setup for 5G4Data intent generation

This note describes how we choose a **production recipe** for turning an operator request in ordinary language into a TM Forum formatted 5G4Data **intent**: a structured graph the rest of the platform can store, validate, and act on. It is the evaluation design used in the 5G4Data use-case validation. Technical cell names and scoring rules are in [CELLS.md](CELLS.md), and[SCORING.md](SCORING.md).

## Why this experiment exists

The language model is not being tested as a chatbot. It is being tested as the step that writes the intent the 5G4Data use case actually consumes. A fluent reply that does not match what the operator asked for, or that the platform’s schema checks reject, is not usable in production.

The question the experiment answers is: **which combination of model, instructions, examples, sampling, user message, and optional output cleanup is fit to serve?**

The harness is the same for different model sizes. Each campaign records which model family was used.

## What we hold constant

Every recipe is given the **same held-out requests**. Those requests were not used to train the fine-tuned weights. They cover the kinds of intent the use case must produce: network quality-of-service, application deployment, and both together.

Each request is scored independently. A recipe’s score on a check is the **share of those held-out requests that pass** that check.

## What we vary

A **cell** is one complete recipe. The default matrix has ten cells. They are not ten unrelated trials; each one turns a single knob so we can see what that knob is worth.


| What we change      | In plain language                                                                                                                        | Why it matters                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Weights             | Off-the-shelf instruct model versus the same model **fine-tuned** on 5G4Data intents                                                     | Shows whether domain training is necessary, not only prompting                         |
| System instructions | Short versus long standing instructions baked into the served model                                                                      | Tests how much written procedure the model needs                                       |
| Few-shot examples   | No examples versus three worked examples (network, deployment, and both)                                                                 | Tests whether showing the expected graph shape helps                                   |
| Temperature         | How freely the model may vary its wording (`0`, `0.1`, `0.7`)                                                                            | Lower values are more deterministic; we need graphs, not creative prose                |
| User message        | Request only versus request **plus grounding** (the concrete application, chart, and data-centre identifiers the platform already knows) | Grounding is how live serving attaches the intent to a real cluster                    |
| Post-processing     | Score the model’s raw graph versus run a **cleanup** step first                                                                          | Separates “what the model writes” from “what we would actually hand to the validators” |


Most cells share a served model when they differ only in the user message or in whether cleanup runs. The unique experiment key is the cell, not the model name on the server.

The cleanup used on the post-processing cell is the same class of repair we would apply in production: pad too-short identifiers, replace identifiers copied from the examples, give a new identifier where two different objects illegally share one, fill in the data-centre from grounding, then apply the live agent’s identifier and prefix cleanup. Other cells are scored on raw model output so the table still shows what the model itself produces.

## How we decide a recipe is good enough

Three questions, in this order of importance:

1. **Does the intent match the operator’s request?**
  The right kinds of expectation (network, deployment, or both), the numeric quality targets named in the text, the named workload and place, and no extra sustainability or coordination clauses the operator did not ask for. Matching a reference graph token-for-token is **not** the primary test.
2. **Do the formal validators accept it?**
  Two independent schema checks must both pass: the 5G4Data use-case shapes and the TM Forum Intent Ontology (TIO) shapes. Either failing is a fail.
3. **Is the graph structurally complete?**
  One intent; the expectation types the request requires; conditions and context as the kind of request requires; one reporting expectation per main expectation; the usual block order; unique typed identifiers that are not copied from the written examples.

A cell is **production-eligible** only if all three are at least **70%** on the held-out requests. Among eligible cells we pick the one that scores highest on meaning, then on both schema checks, then on structure. Being good at only one of the three is not enough.

Each campaign writes a summary table (every check × every cell), a short production recommendation, and a per-cell report. Those files are the evidence pack for that run; they are not themselves the experimental design.

## What this experiment does not cover

It does not measure radio or core-network key performance indicators, end-to-end slice fulfilment, or human preference for wording. It measures whether the generated intent is **semantically faithful, schema-valid, and structurally complete** for the 5G4Data use case, under the recipes we are prepared to serve.