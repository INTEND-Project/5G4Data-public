# Generation of CoordinationExpectation in intents (using the Controller Studio)

This guide explains how to activate **inCoord-compatible CoordinationExpectation** in intents when authoring Controller scripts, and how the **utility functions** that drive coordination are generated. 

Generation of a CoordinationExpectation in an intent is triggered by natural-language phrases inside the quoted `prompt "…"` on a `create intent` line. Example:

```text
create intent using intentGen storage prometheus prompt "Deploy a small llm in a datacenter near Tromsø/Norway with symmetric coordination on token throughput and energy consumption" as llmIntent
```

## Overview

When coordination is requested, the intent-generating agent adds:

- a **data5g:CoordinationExpectation** (`icm:target data5g:coordination-service`)
- coordination **conditions** (one per coordinated metric)
- a **utility function** (`ut:UtilityInformation` + `fun:function` summing sub-utilities)
- **data5g:coordinates** linking the coordination expectation to the expectation(s) that own the coordinated metrics (deployment, sustainability, and/or network)
- an **icm:ObservationReportingExpectation** for target `data5g:coordination-service`

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


| Resource           | Role                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `data5g:UI<uuid4>` | `ut:UtilityInformation` — wires utility arguments to coordination conditions via `ut:forMetric` |
| `data5g:UP<uuid4>` | `ut:UtilityProfile` — min/max utility bounds (typically 0.0–1.0)                                |
| `data5g:UN<uuid4>` | `fun:function` — sums one sub-utility per coordinated metric                                    |


Each sub-utility is typically an `mf:logistic` call (or `mf:poly` for secondary energy metrics in weighted profiles).

### Reference examples (from TUW)

These Turtle files show **postprocessor-canonical** coordination output (complete four-argument `mf:logistic` calls, `icm:target data5g:coordination-service` on both CE and coordination RE). They are metric-specific patterns, not copy-paste templates.


| Example                                                                  | Profile   | Coordinated metrics (in that file)     | Notes                                                               |
| ------------------------------------------------------------------------ | --------- | -------------------------------------- | ------------------------------------------------------------------- |
| [intent_utility_symmetric.ttl](../examples/intent_utility_symmetric.ttl) | symmetric | throughput (`p99-tps-target`) + energy | equal `limit` (0.5 each); both metrics use `mf:logistic`            |
| [intent_utility_weighted.ttl](../examples/intent_utility_weighted.ttl)   | weighted  | throughput + energy                    | higher throughput `limit` (0.7); energy uses `mf:poly` as secondary |


In both files:

- `data5g:CoordinationExpectation` targets `data5g:coordination-service` and lists coordinated expectations under `data5g:coordinates`.
- `icm:ObservationReportingExpectation` for coordination targets `data5g:coordination-service` (not `data5g:llm-service`).
- Utility argument locals follow the coordinated metric stems in that intent (for example `U_arg_tps`, `U_arg_energy-consumption`) — use `U_arg_<metric-stem>` for your own metrics.

The LLM may emit incomplete drafts; the coordination utility postprocessor replaces them with shapes like these before storage.

## Generation flow

The LLM may emit incomplete utility drafts but will be fixed by postprocessors before GraphDB write.

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

## Example of generated intent

For this "create intent ... " script line:

```text
create intent using intentGen storage prometheus prompt "Deploy a small llm in a datacenter near Tromsø/Norway with symmetric coordination on token throughput and energy consumption" as llmIntent
```

The generated intent is:

```turtle
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:If7571b19f8574b87a651f2f6c4788e40 a icm:Intent ;
    dct:description "Deploy a small llm in a datacenter near Tromsø/Norway with symmetric coordination on token throughput and energy consumption" ;
    imo:handler "inSustain" ;
    imo:owner "inChat" ;
    log:allOf data5g:CE91e3b617a922485ea475b2d0346d4776, 
              data5g:DEb49e267bf8a5491c83824da2a7d7f3f9, 
              data5g:RE522c6d6438294dd8919fdb3be5ec1c05, 
              data5g:REd0efa6d9094b47238a124d55807c5824, 
              data5g:REd5766ccd55774c0e9681c3eeb23653d5, 
              data5g:SEef250b0f8a284f9d8a527a8e3dabf37f .

data5g:DEb49e267bf8a5491c83824da2a7d7f3f9 a data5g:DeploymentExpectation,
    icm:Expectation,
    icm:IntentElement  ;
    icm:target data5g:deployment ;
    imo:eventFor data5g:DEb49e267bf8a5491c83824da2a7d7f3f9 ;
    log:allOf data5g:CO530274a23f124a788d5bd75d9bf84e72, 
              data5g:CX20cd0f6f38b94ff0a2e82b4ff8f8ea66 ;
    time:delay ( data5g:lastReportInstant data5g:durationDeployment_CO530274a23f124a788d5bd75d9bf84e72 ) ;
    rdfs:subClassOf imo:Event .

data5g:CO530274a23f124a788d5bd75d9bf84e72 a icm:Condition ;
    dct:description "p99-token-target condition quan:larger: 400 token/s" ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_CO530274a23f124a788d5bd75d9bf84e72 ;
        quan:larger [
            quan:unit "token/s" ;
            rdf:value 400
            ]
        ] .

data5g:CX20cd0f6f38b94ff0a2e82b4ff8f8ea66 a icm:Context ;
    data5g:Application "rusty-llm" ;
    data5g:DataCenter "EC_31" ;
    data5g:DeploymentDescriptor "https://start5g-1.cs.uit.no/wchartmuseum/api/charts/rusty-llm/0.1.26" .

data5g:durationDeployment_CO530274a23f124a788d5bd75d9bf84e72 a time:DurationDescription ;
    time:numericDuration 10.0 ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventDeployment_CO530274a23f124a788d5bd75d9bf84e72 a rdfs:Class ;
    imo:eventFor data5g:DEb49e267bf8a5491c83824da2a7d7f3f9 ;
    time:delay ( data5g:lastReportInstant data5g:durationDeployment_CO530274a23f124a788d5bd75d9bf84e72 ) ;
    rdfs:subClassOf imo:Event .

data5g:SEef250b0f8a284f9d8a527a8e3dabf37f a data5g:SustainabilityExpectation,
    icm:Expectation,
    icm:IntentElement  ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COcfb56efb02764835a525699eca1828ef, 
              data5g:COe2a24bcd6ce24cb6abd4482fdb9169f2, 
              data5g:CX20cd0f6f38b94ff0a2e82b4ff8f8ea66 .

data5g:COcfb56efb02764835a525699eca1828ef a icm:Condition ;
    dct:description "power-consumption condition quan:smaller: 50 W" ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:power-consumption_COcfb56efb02764835a525699eca1828ef ;
        quan:smaller [
            quan:unit "W" ;
            rdf:value 50
            ]
        ] .

data5g:COe2a24bcd6ce24cb6abd4482fdb9169f2 a icm:Condition ;
    dct:description "energy-consumption condition quan:smaller: 100 MJ" ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COe2a24bcd6ce24cb6abd4482fdb9169f2 ;
        quan:smaller [
            quan:unit "MJ" ;
            rdf:value 100
            ]
        ] .

data5g:TenMinuteReportEventSustainability_COcfb56efb02764835a525699eca1828ef a rdfs:Class ;
    imo:eventFor data5g:SEef250b0f8a284f9d8a527a8e3dabf37f ;
    time:delay ( data5g:lastReportInstant data5g:durationSustainability_COcfb56efb02764835a525699eca1828ef ) ;
    rdfs:subClassOf imo:Event .

data5g:durationSustainability_COcfb56efb02764835a525699eca1828ef a time:DurationDescription ;
    time:numericDuration 10.0 ;
    time:unitType time:unitMinute .

data5g:CE91e3b617a922485ea475b2d0346d4776 a data5g:CoordinationExpectation ;
    data5g:coordinates data5g:DEb49e267bf8a5491c83824da2a7d7f3f9, 
                       data5g:SEef250b0f8a284f9d8a527a8e3dabf37f ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:CO530274a23f124a788d5bd75d9bf84e72, 
              data5g:COe2a24bcd6ce24cb6abd4482fdb9169f2 ;
    ut:utility data5g:UIf7571b19f8574b87a651f2f6c4788e40 .

data5g:TenMinuteReportEventCoordination_CE91e3b617a922485ea475b2d0346d4776 a rdfs:Class ;
    imo:eventFor data5g:CE91e3b617a922485ea475b2d0346d4776 ;
    time:delay ( data5g:lastReportInstant data5g:durationCoordination_CE91e3b617a922485ea475b2d0346d4776 ) ;
    rdfs:subClassOf imo:Event .

data5g:durationCoordination_CE91e3b617a922485ea475b2d0346d4776 a time:DurationDescription ;
    time:numericDuration 10.0 ;
    time:unitType time:unitMinute .

data5g:RE522c6d6438294dd8919fdb3be5ec1c05 a icm:ObservationReportingExpectation ;
    icm:reportDestinations [
        a rdfs:Container ;
        rdfs:member data5g:prometheus
        ]  ;
    icm:reportTriggers [
        a rdfs:Container ;
        rdfs:member data5g:TenMinuteReportEventCoordination_CE91e3b617a922485ea475b2d0346d4776
        ]  ;
    icm:target data5g:coordination-service .

data5g:REd0efa6d9094b47238a124d55807c5824 a icm:ObservationReportingExpectation ;
    dct:description "Deployment observation reports on the configured interval." ;
    icm:reportDestinations [
        a rdfs:Container ;
        rdfs:member data5g:prometheus
        ]  ;
    icm:reportTriggers [
        a rdfs:Container ;
        rdfs:member data5g:TenMinuteReportEventDeployment_CO530274a23f124a788d5bd75d9bf84e72
        ]  ;
    icm:target data5g:deployment .

data5g:REd5766ccd55774c0e9681c3eeb23653d5 a icm:ObservationReportingExpectation ;
    dct:description "Sustainability observation reports on the configured interval." ;
    icm:reportDestinations [
        a rdfs:Container ;
        rdfs:member data5g:prometheus
        ]  ;
    icm:reportTriggers [
        a rdfs:Container ;
        rdfs:member data5g:TenMinuteReportEventSustainability_COcfb56efb02764835a525699eca1828ef
        ]  ;
    icm:target data5g:sustainability .

data5g:UIf7571b19f8574b87a651f2f6c4788e40 a ut:UtilityInformation ;
    ut:forMetric ( data5g:U_arg_p99-token-target data5g:p99-token-target_CO530274a23f124a788d5bd75d9bf84e72 ), ( data5g:U_arg_energy-consumption data5g:energy-consumption_COe2a24bcd6ce24cb6abd4482fdb9169f2 ) ;
    ut:function data5g:UNf7571b19f8574b87a651f2f6c4788e40 ;
    ut:utilityProfile data5g:UPf7571b19f8574b87a651f2f6c4788e40 ;
    ut:withArguments ( data5g:U_arg_p99-token-target data5g:U_arg_energy-consumption ) .

data5g:UPf7571b19f8574b87a651f2f6c4788e40 a ut:UtilityProfile ;
    ut:maxUtility "1.0"^^xsd:decimal ;
    ut:minUtility "0.0"^^xsd:decimal .

data5g:UNf7571b19f8574b87a651f2f6c4788e40 a fun:function ;
    fun:argumentNames ( data5g:U_arg_p99-token-target data5g:U_arg_energy-consumption ) ;
    fun:argumentTypes ( quan:Quantity ) ;
    fun:arityMax 2 ;
    fun:arityMin 2 ;
    fun:resultType quan:Quantity ;
    rdf:value [
        quan:sum ( [
            data5g:standardK "12.0"^^xsd:decimal ;
            data5g:x0Fraction "0.85"^^xsd:decimal ;
            mf:logistic ( data5g:U_arg_p99-token-target "0.03"^^xsd:decimal "0.5"^^xsd:decimal "340token/s"^^quan:quantity )
            ] [
            data5g:standardK "12.0"^^xsd:decimal ;
            data5g:x0Fraction "0.85"^^xsd:decimal ;
            mf:logistic ( data5g:U_arg_energy-consumption "-0.12"^^xsd:decimal "0.5"^^xsd:decimal "115MJ"^^quan:quantity )
            ] )
        ] .
```

