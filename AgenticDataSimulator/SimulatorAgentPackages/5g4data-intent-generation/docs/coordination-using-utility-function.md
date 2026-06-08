# Generation of CoordinationExpectation in intents (using the Controllrer Studio)

This guide explains how to activate **inCoord-compatible CoordinationExpectation** in intents when authoring Controller scripts, and how the **utility functions** that drive coordination are generated. 

Generation of a CoordinationExpectation in an intent is triggered by natural-language phrases inside the quoted `prompt "…"` on a `create intent` line. Example:
```text
create intent using intentGen storage prometheus prompt "Deploy a small llm in a datacenter near Tromsø/Norway with symmetric coordination on token throughput and energy consumption" as llmIntent
```

## Overview

When coordination is requested, the intent-generating agent adds:

- a `**data5g:CoordinationExpectation`** (`icm:target data5g:coordination-service`)
- coordination **conditions** (one per coordinated metric)
- a **utility function** (`ut:UtilityInformation` + `fun:function` summing sub-utilities)
- `**data5g:coordinates`** linking the coordination expectation to the expectation(s) that own the coordinated metrics (deployment, sustainability, and/or network)
- an `**icm:ObservationReportingExpectation`** for target `data5g:coordination-service`

This format is required for [inCoord](https://github.com/INTEND-Project/inCoord-Private) integration testing.

## How activation works

```text
create intent using intentGen storage prometheus prompt "<your natural language here>" as myIntent
```

Include coordination phrases in `<your natural language here>`. The agent classifies the prompt and includes coordination structures in the generated Turtle.

## Trigger phrase reference


| Goal                | Example phrases in prompt                                     |
| ------------------- | ------------------------------------------------------------- |
| Enable coordination | `coordination`, `coordinate`, `inCoord`                       |
| Equal weighting     | `symmetric coordination`, `equal weight`                      |
| Unequal weighting   | `weighted coordination`, `prioritize … over …`                |
| Strictness          | `critical` / `strict`, `trivial` / `lenient` (default: major) |


If, for some strange reason, both symmetric and weighted phrases appear, **weighted** takes precedence.

## Prompt recipes

Symmetric coordination on throughput and energy consumption:

```text
create intent using intentGen storage prometheus prompt "Deploy a small LLM near Tromsø with symmetric coordination on token throughput and energy consumption" as llmIntent
```

Weighted coordination prioritizing latency:

```text
create intent using intentGen storage prometheus prompt "Deploy LLM with weighted coordination prioritizing p99 latency over energy consumption, critical severity" as llmIntent
```

## Choosing coordination metrics

Name the metrics you want coordinated in the prompt (throughput, latency, energy consumption, watts, etc.). The agent:

1. Creates one **condition** per coordinated metric under the coordination expectation.
2. Creates matching utility arguments `U_arg_<metric-stem>` wired via `ut:forMetric`.

Example metric stems (retrieved from Workload catalogue helm charts/values.yaml): `p99-token-target`, `energy-consumption`, `power-consumption`, `networklatency`, `p99_computelatency`. Prompts that mention energy consumption typically coordinate on `energy-consumption` (joules) from the workload catalogue. The coordination utility postprocessor aligns CE metric references with catalogue stems and can infer a missing second coordinated metric from the user prompt plus deployment/sustainability conditions.

## Tips

- Combine deployment, sustainability, network, and coordination requirements in one prompt as needed.
- `data5g:coordinates` links to the expectations that own the coordinated metrics—for example deployment + sustainability for throughput/energy coordination. **Network** is included only when coordinated metrics are network-related (latency, bandwidth) or the prompt explicitly requests network QoS.
- Use `storage prometheus` when you plan to store observations in Prometheus (TBD if it is needed).

## Utility function resources

When coordination is enabled, the intent-generation agent emits a draft utility block (using a gen-AI model). A **postprocessor** then replaces that draft with canonical Turtle if it is malformed:


| Resource                     | Role                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `data5g:U_coord`             | `ut:UtilityInformation` — wires utility arguments to coordination conditions via `ut:forMetric` |
| `data5g:UP_coord`            | `ut:UtilityProfile` — min/max utility bounds (typically 0.0–1.0)                                |
| `data5g:utilityFn_<profile>` | `fun:function` — sums one sub-utility per coordinated metric                                    |


Each sub-utility is typically an `mf:logistic` call (or `mf:poly` for secondary energy metrics in weighted profiles). Reference patterns:

- `[examples/intent_utility_symmetric.ttl](../examples/intent_utility_symmetric.ttl)`
- `[examples/intent_utility_weighted.ttl](../examples/intent_utility_weighted.ttl)`

Those files are **patterns**. Argument names like `U_arg_tps` and `U_arg_energy-consumption` reflect the metrics used in that specific example.

## Generation flow

The LLM may emit incomplete utility drafts (for example `mf:logistic` with only two arguments). The coordination utility postprocessor in `[tools/postprocess/coordinationUtility.ts](../tools/postprocess/coordinationUtility.ts)` always normalizes the final output.

```mermaid
flowchart TD
  Prompt["create intent prompt text"]
  Classify["Keyword classification"]
  LLM["LLM emits intent Turtle + draft utility blocks"]
  Strip["stripDraftUtilityBlocks"]
  Complete{"Every mf:logistic has 4 typed args?"}
  Parse["Parse CE conditions + infer missing metrics"]
  Derive["buildSubUtilitySpecs"]
  Remove["removeUtilityBlocks"]
  Append["Append U_coord, UP_coord, utilityFn"]
  Out["Final Turtle stored in GraphDB"]

  Prompt --> Classify
  Classify --> LLM
  LLM --> Strip
  Strip --> Complete
  Complete -->|no| Strip
  Complete -->|yes kept only if complete| Parse
  Strip --> Parse
  Parse --> Derive
  Derive --> Remove
  Remove --> Append
  Append --> Out
```



Numeric parameters (`k`, `limit`, `x0`) are **not** invented by the LLM. They are derived deterministically in `[tools/postprocess/coordinationUtilityDerive.ts](../tools/postprocess/coordinationUtilityDerive.ts)` from:

1. **Severity** — parsed from prompt keywords (`critical`, `trivial`, …)
2. **Condition thresholds** — metric targets the agent places in coordination conditions (from your prompt or workload catalogue hints)
3. **Quantifier** — `quan:atLeast`, `quan:larger`, or `quan:smaller` on each condition

## `mf:logistic` structure

Each sub-utility uses four arguments inside `mf:logistic`:

```turtle
mf:logistic (
    data5g:U_arg_<metric-stem>    # utility argument (metric)
    "0.03"^^xsd:decimal            # k — steepness; negative when smaller is better
    "0.5"^^xsd:decimal             # limit — sub-utility weight cap
    "340tokens/s"^^quan:quantity   # x0 — logistic midpoint as a quantity
)
```

Metadata on the surrounding blank node records the severity inputs used for derivation:

```turtle
data5g:standardK "12"^^xsd:decimal ;
data5g:x0Fraction "0.85"^^xsd:decimal
```

For `quan:smaller` conditions (for example energy consumption), **k is negative** because utility rises as the metric decreases.

## How k and x0 are computed

```mermaid
flowchart LR
  PromptText["Prompt text"]
  SeverityFlags["coordinationSeverity* flags"]
  Severity["major / critical / trivial"]
  Params["standardK + x0Fraction"]
  Thresholds["CE condition thresholds"]
  Quantifier["atLeast / larger / smaller"]
  K["k = sign x standardK / threshold"]
  X0["x0 quantity from threshold + x0Fraction"]
  Logistic["mf:logistic arguments"]

  PromptText --> SeverityFlags --> Severity --> Params
  PromptText --> Thresholds
  Thresholds --> Quantifier
  Params --> K
  Params --> X0
  Thresholds --> K
  Thresholds --> X0
  Quantifier --> K
  Quantifier --> X0
  K --> Logistic
  X0 --> Logistic
```



### Severity → `standardK` and `x0Fraction`


| Severity            | Trigger phrases in prompt       | `standardK` | `x0Fraction` |
| ------------------- | ------------------------------- | ----------- | ------------ |
| **major** (default) | *(none)*                        | 12          | 0.85         |
| **critical**        | `critical`, `critic`, `strict`  | 30          | 0.95         |
| **trivial**         | `trivial`, `lenient`, `relaxed` | 5           | 0.8          |


### Formulas

**k** (per metric):

```
k = + (standardK / threshold)   for quan:atLeast or quan:larger
k = - (standardK / threshold)   for quan:smaller
```

**x0** (midpoint quantity):

```
x0 = ceil(x0Fraction × threshold)              for atLeast / larger
x0 = ceil(threshold × (2 - x0Fraction))          for smaller
```

The unit string comes from the condition (`quan:unit`), for example `tokens/s` or `J`.

### Worked example (symmetric, major severity)

Conditions: throughput `quan:atLeast` 400 tokens/s; energy `quan:smaller` 10000 J.


| Metric     | k                                      | limit (symmetric, 2 metrics) | x0                             |
| ---------- | -------------------------------------- | ---------------------------- | ------------------------------ |
| Throughput | `+12/400` = `"0.03"^^xsd:decimal`      | `"0.5"^^xsd:decimal`         | `"340tokens/s"^^quan:quantity` |
| Energy     | `-12/10000` = `"-0.0012"^^xsd:decimal` | `"0.5"^^xsd:decimal`         | `"11500J"^^quan:quantity`      |


`limit` is controlled by **symmetric** vs **weighted** coordination phrases, not by severity. Symmetric splits utility equally (`0.5` each for two metrics); weighted assigns a higher limit to the prioritized metric.

## Prompt examples that change k and x0

You cannot set `k` or `x0` literally in the prompt (there is no `k=0.03` syntax). You influence them **indirectly** through severity phrases and condition thresholds.

### Default curves (major severity)

```text
create intent using intentGen storage prometheus prompt "Deploy a small LLM with symmetric coordination on token throughput and energy consumption" as llmIntent
```

Uses `standardK=12`, `x0Fraction=0.85`, and catalogue/default thresholds (for example 400 tokens/s, 10000 J).

### Stricter curves — steeper k, x0 closer to threshold

```text
create intent using intentGen storage prometheus prompt "Deploy LLM with symmetric coordination on token throughput and energy consumption, critical severity" as llmIntent
```

Effect: `standardK=30`, `x0Fraction=0.95` → larger |k| and midpoints nearer the bound (for example throughput x0 = `ceil(0.95 × 400)` = 380 tokens/s).

### Gentler curves — shallower k, x0 farther from threshold

```text
create intent using intentGen storage prometheus prompt "Deploy LLM with symmetric coordination on token throughput and energy consumption, trivial severity" as llmIntent
```

Effect: `standardK=5`, `x0Fraction=0.8` → smaller |k| and midpoints farther from the bound (for example throughput x0 = `ceil(0.8 × 400)` = 320 tokens/s).

### Change k and x0 via explicit thresholds

Thresholds in the prompt become condition `rdf:value` entries, which directly rescale k and x0:

```text
create intent using intentGen storage prometheus prompt "Deploy LLM with symmetric coordination: at least 600 tokens/s and energy consumption below 5000 J" as llmIntent
```

Compared with the 400 / 10000 J defaults (major severity):


| Metric                 | k change                           | x0 change               |
| ---------------------- | ---------------------------------- | ----------------------- |
| Throughput 600 token/s | `12/600` = 0.02 (was 0.03)         | `510tokens/s` (was 340) |
| Energy 5000 J          | `-12/5000` ≈ -0.0024 (was -0.0012) | `5750J` (was 11500)     |


### Combine severity and thresholds

```text
create intent using intentGen storage prometheus prompt "Deploy LLM with weighted coordination prioritizing token throughput over energy consumption, critical severity, at least 500 tokens/s, energy below 8000 J" as llmIntent
```

Effect:

- **critical** → `standardK=30`, `x0Fraction=0.95`
- **500 tokens/s** / **8000 J** → thresholds in k and x0 formulas
- **weighted** → throughput `limit` ≈ 0.7, energy ≈ 0.3 (energy may use `mf:poly` instead of `mf:logistic`)

## What the prompt does not control

- Direct numeric `k`, `x0`, or `x0Fraction` overrides per metric
- Per-metric severity (one severity level applies to all coordinated metrics)
- The four-argument shape of `mf:logistic` — the postprocessor always enforces `(metric, k, limit, x0)`

