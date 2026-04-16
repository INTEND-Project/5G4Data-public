---
name: tmf-intent-authoring
description: Translate natural-language 5G4Data requirements into TM Forum ontology-based Turtle intents, using only workloads available in the workload catalogue. Use when creating, revising, validating, or explaining 5G4Data intents involving NetworkExpectation, DeploymentExpectation, ReportingExpectation, bandwidth, latency, workload-chart objectives, UUID4 identifiers, ChartMuseum workload lookup, or Turtle intent files.
---

# TM Forum Intent Authoring

## Purpose

Translate natural language to legal 5G4Data TMF Turtle intents. Infer intent structure, ask minimal clarifying questions, and stay strictly within the allowed subset.

## Read First

Resolve ontology/examples from workspace root. In managed-agent sessions, the private repo is mounted at `/workspace/5G4Data-private`.

| Workspace root | Ontology entrypoint | Example intents |
|----------------|---------------------|------------------|
| `5G4Data-public` (monorepo) | `/workspace/5G4Data-private/TM-Forum-Intent-Toolkit/TMForumIntentOntology/IntentCommonModel.ttl` | `Intent-Simulator/intents` |
| `AgentSyntheticTimeseriesGeneration` (this package) | `/workspace/5G4Data-private/TM-Forum-Intent-Toolkit/TMForumIntentOntology/IntentCommonModel.ttl` | `../Intent-Simulator/intents` |

Start with `IntentCommonModel.ttl`; include other ontology files only as needed.

## Required Data Sources

### Workload catalogue (mandatory for deployment)

- Base URL: `https://start5g-1.cs.uit.no/wchartmuseum`
- API style: ChartMuseum
- Endpoints: `GET /api/charts`, `GET /api/charts/<name>`, `GET /api/charts/<name>/<version>`

Rules:
- `DeploymentExpectation` is allowed only if a suitable catalogue workload exists.
- Never invent workload/chart/version/deployment descriptor values.
- Retrieve selected chart and inspect `values.yaml`.
- Deployment conditions must come from `values.yaml` `objectives`.
- If no suitable workload exists, clearly state deployment is out of scope.

### GraphDB/SPARQL lookup (mandatory when locality matters)

- Geocode place name to coordinates.
- Query GraphDB at `http://start5g-1.cs.uit.no:7200/`, graph `http://intendproject.eu/telenor/infra`.
- Use SPARQL nearest edge data center for `data5g:DataCenter`.
- If unresolved/ambiguous, ask follow-up; never guess.

## Required workflow

1. Read ontology + examples first.
2. Extract: business goal, locality, deployment need, network QoS need, thresholds.
3. If deployment implied: do catalogue lookup before drafting deployment semantics.
4. If locality matters: geocode + SPARQL nearest-edge lookup.
5. Choose expectation shape: deployment-only, network-only, or both.
6. Ask only missing critical fields:
   - `dct:description`, `imo:handler`, `imo:owner`
   - deployment workload/data center/descriptor/objective thresholds
   - network bandwidth/latency thresholds
7. Output Turtle unless prose requested.
8. Run validation checklist.

## Deployment condition extraction from Helm charts

Rules:
- Read `objectives` in selected chart `values.yaml`.
- Create one deployment condition per objective unless user narrows scope.
- Metric stem is objective `name`, suffixed with `_<condition-id>`.
- Use user-provided threshold when available; otherwise use `tmf-value-hint`.
- Null runtime `value` does not block condition creation.
- If no reliable objectives exist, ask follow-up or mark deployment-condition generation out-of-scope.

Example:

```yaml
objectives:
  - name: p99-token-target
    value: 0.0
    tmf-value-hint: 400.0
    measuredBy: intend/p99token
```

Use metric `data5g:p99-token-target_<condition-id>`.

## Inference rules for expectation selection

Heuristics:
- Deployment expectation: placement/local inference/edge/proximity/privacy-through-locality.
- Network expectation: latency/bandwidth/QoS/connectivity guarantees.
- Use both when both placement and communication quality are required.
- If only placement cues exist -> deployment-only (state assumption).
- If only communication cues exist -> network-only.
- Keep deployment only if workload exists in catalogue.

Cue mapping:
- “local compute”, “edge”, “run close to me”, “keep data local” -> deployment
- “private dialogue/prompts” -> deployment locality (privacy approximated via local execution)
- “low response time”, “fast replies” -> latency
- “stable/predictable performance” -> likely network QoS (possibly plus locality)
- “high throughput”, “many users”, “large transfer” -> bandwidth

## Allowed 5G4Data subset

Allowed expectation classes only:
- `data5g:NetworkExpectation`
- `data5g:DeploymentExpectation`
- `icm:ReportingExpectation`

Legal combinations:
- network-only
- deployment-only
- network + deployment

Never introduce other expectation types.

## Condition restrictions

- Deployment conditions: only from chart `values.yaml` `objectives`.
- Network conditions: only bandwidth and latency.
- Logistic behavior allowed only when user explicitly requests soft/non-linear semantics.
- Default operators: `quan:smaller`, `quan:larger`, `quan:inRange`.

## Naming and identifier rules

Use fresh UUID4-derived IDs for intent, all conditions, contexts, expectations, reporting expectations, and extra region/helper resources.

Naming style:
- `data5g:I<uuid4>`
- `data5g:CO<uuid4>`
- `data5g:CX<uuid4>`
- `data5g:DE<uuid4>`
- `data5g:NE<uuid4>`
- `data5g:RE<uuid4>`
- `data5g:RG<uuid4>`

Rules:
- Keep UUID4 origin intact (hyphen removal allowed in local names).
- Never reuse one UUID for different resources.
- Use condition-scoped property suffixes (`_<condition-id>`).

## Local modeling rules

- Root resource is `icm:Intent`.
- Root composition defaults to `log:allOf`; use other logical operators only when explicitly justified.
- Each expectation has exactly one `icm:target`.
- Targets: deployment -> `data5g:deployment`, network -> `data5g:network-slice`, reporting -> same target it reports on.
- Include one reporting expectation per target by default.

## Context guidance

Use minimal context needed for the requested intent.

Typical deployment context:
- `data5g:Application`
- `data5g:DataCenter`
- `data5g:DeploymentDescriptor`

Typical network context:
- `data5g:appliesToCustomer`
- `data5g:appliesToRegion`

Do not invent unsupported context properties. `data5g:DeploymentDescriptor` must come from selected catalogue workload.

## Property naming guidance

- Keep one consistent naming pattern per file.
- Preferred forms:
  - bandwidth: `data5g:bandwidth_<condition-id>`
  - latency: `data5g:networklatency_<condition-id>`
  - deployment metric: `data5g:<objective-name>_<condition-id>`

## Validation checklist

Before returning:
- Root is `icm:Intent`.
- Root `log:allOf` references only included expectations/reporting expectations.
- Every referenced condition/context is defined exactly once.
- Deployment conditions are from chart objectives.
- Network conditions only use bandwidth/latency.
- No unsupported expectation classes.
- Expectation targets are correct.
- Reporting expectations target the resource they report on.
- Deployment workload and descriptor come from catalogue.
- `data5g:DataCenter` from coordinate + SPARQL nearest-edge process when locality used.
- Units: latency `"ms"`, bandwidth `"mbit/s"` (unless chart objective defines differently).
- All IDs are unique UUID4-derived values.
- Turtle syntax/punctuation is complete.

## Response style

- If user asks for full intent: return ready-to-save Turtle.
- If key values are missing: ask the minimum clarifying questions.
- If request conflicts with allowed subset: explain restriction and offer closest legal mapping.
- If deployment is requested but no catalogue workload fits: clearly state out-of-scope.
