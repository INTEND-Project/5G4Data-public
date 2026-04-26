---
name: tmf-intent-authoring
description: Translate natural-language 5G4Data requirements into TM Forum ontology-based Turtle intents, using only workloads available in the workload catalogue. Use when creating, revising, validating, or explaining 5G4Data intents involving NetworkExpectation, DeploymentExpectation, ReportingExpectation, bandwidth, latency, workload-chart objectives, ChartMuseum workload lookup, or Turtle intent files.
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

## Default Turtle skeleton

Use this as a starting shape, then remove the blocks that are not needed when creating the actual intent.

```turtle
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:I<uuid4> a icm:Intent ;
    dct:description "<intent description>" ;
    imo:handler "<handler>" ;
    imo:owner "<owner>" ;
    log:allOf data5g:DE<uuid4>,
        data5g:NE<uuid4>,
        data5g:RE<uuid4>,
        data5g:RE<uuid4> .
```

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
- Query GraphDB at `https://start5g-1.cs.uit.no/graphdb/`, graph `http://intendproject.eu/telenor/infra`.
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

## Inference rules for expectation selection

Heuristics:
- Deployment expectation: placement/local inference/edge/proximity/privacy-through-locality.
- Network expectation: latency/bandwidth/QoS/connectivity guarantees.
- Use both when both placement and communication quality are required.
- If only placement cues exist -> deployment-only (state assumption).
- If only communication cues exist -> network-only.
- Keep deployment only if workload exists in catalogue.

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

Formatting requirement:
- Local-name UUID suffix MUST be 32 lowercase hex characters with no hyphens.

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
