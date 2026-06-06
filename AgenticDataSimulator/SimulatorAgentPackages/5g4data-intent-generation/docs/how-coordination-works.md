# How coordination works in create-intent prompts

This guide explains how to activate **inCoord-compatible coordination** when authoring Controller scripts. Coordination is triggered by natural-language phrases inside the quoted `prompt "…"` on a `create intent` line—there is no separate DSL keyword.

## Overview

When coordination is requested, the intent-generation agent adds:

- a **`data5g:CoordinationExpectation`** (`icm:target data5g:llm-service`)
- coordination **conditions** (one per coordinated metric)
- a **utility function** (`ut:UtilityInformation` + `fun:function` summing sub-utilities)
- **`data5g:coordinates`** linking the coordination expectation to the expectation(s) that own the coordinated metrics (deployment, sustainability, and/or network—not always network)
- an **`icm:ObservationReportingExpectation`** for target `data5g:llm-service`

This format is required for [inCoord](https://github.com/INTEND-Project/inCoord-Private) integration testing.

## How activation works

```text
create intent using intentGen storage prometheus prompt "<your natural language here>" as myIntent
```

Include coordination phrases in `<your natural language here>`. The agent classifies the prompt and includes coordination structures in the generated Turtle.

## Trigger phrase reference

| Goal | Example phrases in prompt |
|------|---------------------------|
| Enable coordination | `coordination`, `coordinate`, `inCoord` |
| Equal weighting | `symmetric coordination`, `equal weight` |
| Unequal weighting | `weighted coordination`, `prioritize … over …` |
| Strictness | `critical` / `strict`, `trivial` / `lenient` (default: major) |

If both symmetric and weighted phrases appear, **weighted** takes precedence.

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

Metrics are **not** fixed to TPS + energy. Name the metrics you want coordinated in the prompt (throughput, latency, energy consumption, watts, etc.). The agent:

1. Creates one **condition** per coordinated metric under the coordination expectation.
2. Creates matching utility arguments `U_arg_<metric-stem>` wired via `ut:forMetric`.

Example metric stems: `p99-tps-target`, `energy-consumption`, `networklatency`, `p99_computelatency`. Prompts that mention energy, joules, or power typically map to the `energy-consumption` metric.

## What gets generated

See reference output in:

- [`examples/intent_utility_symmetric.ttl`](../examples/intent_utility_symmetric.ttl)
- [`examples/intent_utility_weighted.ttl`](../examples/intent_utility_weighted.ttl)

Those files are **patterns**. Argument names like `U_arg_tps` and `U_arg_energy-consumption` reflect the metrics used in that specific example.

## Tips

- Combine deployment, sustainability, network, and coordination requirements in one prompt as needed.
- `data5g:coordinates` links to the expectations that own the coordinated metrics—for example deployment + sustainability for throughput/energy coordination. **Network** is included only when coordinated metrics are network-related (latency, bandwidth) or the prompt explicitly requests network QoS.
- Use `storage prometheus` when you plan to view coordination metrics in Grafana.

## Next steps

1. Run the script in Controller (**Run Script**).
2. Confirm the intent appears in the **Intents** panel (green when observation data is ready).
3. Send the intent to **inCoord** via the **Tools** panel (configure the TMF921 URL first).

See also the main [AgenticDataSimulator README](../../../README.md) for `create intent` and observation-report flows.
