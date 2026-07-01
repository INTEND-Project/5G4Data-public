---
name: tmf-intent-authoring
description: Translate natural-language 5G4Data requirements into TM Forum ontology-based Turtle intents, using only workloads available in the workload catalogue. Use when creating, revising, validating, or explaining 5G4Data intents involving NetworkExpectation, DeploymentExpectation, SustainabilityExpectation, ObservationReportingExpectation, bandwidth, latency, sustainability metrics, workload-chart objectives, ChartMuseum workload lookup, or Turtle intent files.
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
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I<uuid4> a icm:Intent ;
    dct:description "<intent description>" ;
    imo:handler "<handler>" ;
    imo:owner "<owner>" ;
    log:allOf data5g:DE<uuid4>,
        data5g:SE<uuid4>,
        data5g:NE<uuid4>,
        data5g:RE<uuid4>,
        data5g:RE<uuid4>,
        data5g:RE<uuid4> .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "<objective-name> condition <quan-op>: <value> <unit>" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:<objective-name>___ID_CONDITION_<LABEL>_1__ ;
            <quan-op> [ quan:unit "<unit>" ;
                    rdf:value <value> ] ] .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "Bandwidth condition quan:larger: <value>mbit/s" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth___ID_CONDITION_BANDWIDTH_1__ ;
            quan:larger [ quan:unit "mbit/s" ;
                    rdf:value <value> ] ] .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "Latency condition quan:smaller: <value>ms" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:latency___ID_CONDITION_LATENCY_1__ ;
            quan:smaller [ quan:unit "ms" ;
                    rdf:value <value> ] ] .

data5g:CX<uuid4> a icm:Context ;
    data5g:Application "<application>" ;
    data5g:DataCenter "<data-center>" ;
    data5g:DeploymentDescriptor "<catalogue-deployment-descriptor-url>" .

data5g:CX<uuid4> a icm:Context ;
    data5g:appliesToCustomer "<customer>" ;
    data5g:appliesToRegion data5g:RG<uuid4> .

data5g:RG<uuid4> a geo:Feature ;
    geo:hasGeometry [ a geo:Polygon ;
            geo:asWKT "POLYGON((5.86 59.08, 5.89 59.09, 5.92 59.11, 5.86 59.08))"^^geo:wktLiteral ] .

data5g:DE<uuid4> a data5g:DeploymentExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "<deployment expectation description>" ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO<deployment-condition-uuid4>,
        data5g:CX<deployment-context-uuid4> .

data5g:NE<uuid4> a data5g:NetworkExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "<network expectation description>" ;
    icm:target data5g:network-slice ;
    log:allOf data5g:CO<bandwidth-condition-uuid4>,
        data5g:CO<latency-condition-uuid4>,
        data5g:CX<network-context-uuid4> .

data5g:SE<uuid4> a data5g:SustainabilityExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "<sustainability expectation description>" ;
    icm:target data5g:sustainability ;
    log:allOf data5g:CO<sustainability-condition-uuid4>,
        data5g:CX<deployment-context-uuid4> .

data5g:durationDeployment_CO__ID_CONDITION_1__ a time:DurationDescription ;
    time:numericDuration "<reporting-interval-minutes>"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventDeployment_CO__ID_CONDITION_1__ a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:durationDeployment_CO__ID_CONDITION_1__ ) ;
    imo:eventFor data5g:DE<uuid4> .

data5g:RE<uuid4> a icm:ObservationReportingExpectation ;
    dct:description "Deployment observation reports on the configured interval." ;
    icm:target data5g:deployment ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventDeployment_CO__ID_CONDITION_1__ ] .

data5g:durationSustainability_CO__ID_CONDITION_2__ a time:DurationDescription ;
    time:numericDuration "<reporting-interval-minutes>"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventSustainability_CO__ID_CONDITION_2__ a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:durationSustainability_CO__ID_CONDITION_2__ ) ;
    imo:eventFor data5g:SE<uuid4> .

data5g:RE<uuid4> a icm:ObservationReportingExpectation ;
    dct:description "Sustainability observation reports on the configured interval." ;
    icm:target data5g:sustainability ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventSustainability_CO__ID_CONDITION_2__ ] .

data5g:durationNetwork_CO__ID_CONDITION_3__ a time:DurationDescription ;
    time:numericDuration "<reporting-interval-minutes>"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventNetwork_CO__ID_CONDITION_3__ a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:durationNetwork_CO__ID_CONDITION_3__ ) ;
    imo:eventFor data5g:NE<uuid4> .

data5g:RE<uuid4> a icm:ObservationReportingExpectation ;
    dct:description "Network observation reports on the configured interval." ;
    icm:target data5g:network-slice ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventNetwork_CO__ID_CONDITION_3__ ] .
```

## Required Data Sources

### Workload catalogue (mandatory for deployment and sustainability)

- Base URL: `https://start5g-1.cs.uit.no/wchartmuseum`
- API style: ChartMuseum
- Endpoints: `GET /api/charts`, `GET /api/charts/<name>`, `GET /api/charts/<name>/<version>`

Rules:
- `DeploymentExpectation` is allowed only if a suitable catalogue workload exists.
- `SustainabilityExpectation` is allowed only if a suitable catalogue workload exists.
- Never invent workload/chart/version/deployment descriptor values.
- Retrieve selected chart and inspect `values.yaml`.
- Deployment conditions must come from `values.yaml` `objectives`.
- Sustainability conditions must come from `values.yaml` `sustainability`.
- If no suitable workload exists, clearly state deployment/sustainability is out of scope.

### GraphDB/SPARQL lookup (mandatory when locality matters)

- Geocode place name to coordinates.
- The kernel performs infrastructure SPARQL using runtime env: `GRAPHDB_INFRA_ENDPOINT`, `GRAPHDB_INFRA_REPOSITORY_ID`, and `GRAPHDB_INFRA_NAMED_GRAPH` (edge-cluster locality KG — not the intent persistence repo).
- Use the nearest edge data center from that lookup for `data5g:DataCenter`.
- If unresolved/ambiguous, ask follow-up; never guess.

## Required workflow

1. Read ontology + examples first.
2. Extract: business goal, locality, deployment need, sustainability need, network QoS need, thresholds.
3. If deployment or sustainability implied: do catalogue lookup before drafting conditions.
4. If locality matters: geocode + SPARQL nearest-edge lookup.
5. Choose expectation shape: deployment-only, network-only, sustainability-only, or combinations.
6. Ask only missing critical fields:
   - `dct:description`, `imo:handler`, `imo:owner`
   - deployment workload/data center/descriptor/objective thresholds
  - network bandwidth/latency thresholds
  - sustainability metric thresholds
7. Output Turtle unless prose requested.
8. Run validation checklist.

## Deployment condition extraction from Helm charts

Rules:
- Read `objectives` in selected chart `values.yaml`.
- Create one deployment condition per objective unless user narrows scope.
- Metric stem is objective `name`, suffixed with the condition placeholder token (see naming rules below).
- Use user-provided threshold when available; otherwise use `tmf-value-hint`.
- Use user-provided quantifier when available; otherwise use `tmf-quantifier-hint`.
- Use user-provided unit when available; otherwise use `tmf-unit-hint` for `quan:unit`.
- Null runtime `value` does not block condition creation.
- If no reliable objectives exist, ask follow-up or mark deployment-condition generation out-of-scope.

Example:

```yaml
objectives:
  - name: p99-token-target
    value: 0.0
    tmf-value-hint: "400"
    tmf-quantifier-hint: "quan:larger"
    tmf-unit-hint: "token/s"
    measuredBy: intend/p99token
```

Use metric `data5g:p99-token-target___ID_CONDITION_P99_1__` (same placeholder token as the condition; postprocessing yields `data5g:p99-token-target_CO<uuid4>`). Emit `quan:larger [ quan:unit "token/s" ; rdf:value 400 ]` from catalogue hints unless the user overrides.

## Sustainability condition extraction from Helm charts

Rules:
- Read `sustainability` in selected chart `values.yaml`.
- Create one sustainability condition per entry unless user narrows scope.
- Metric stem is metric `name`, suffixed with the condition placeholder token (see naming rules below).
- Use user-provided threshold when available; otherwise use `tmf-value-hint`, then `value`.
- Use user-provided quantifier when available; otherwise use `tmf-quantifier-hint`.
- Use user-provided unit when available; otherwise use `tmf-unit-hint` for `quan:unit`.
- Preserve `measuredBy` from chart entries whenever present.
- If no reliable sustainability metrics exist, ask follow-up or mark sustainability-condition generation out-of-scope.

Example:

```yaml
sustainability:
  - name: energy-consumption
    value: "50"
    tmf-value-hint: "50"
    tmf-quantifier-hint: "quan:larger"
    tmf-unit-hint: "J"
    measuredBy: intend/energy-consumption
  - name: power-consumption
    value: "3000"
    tmf-value-hint: "3000"
    tmf-quantifier-hint: "quan:smaller"
    tmf-unit-hint: "W"
    measuredBy: intend/power-consumption
```

Use metric `data5g:energy-consumption___ID_CONDITION_ENERGY_1__` (postprocessing yields `data5g:energy-consumption_CO<uuid4>`). Emit sustainability thresholds from catalogue hints unless the user overrides. Legacy chart metrics such as `container-cpu-watts` and `container-cpu-joules-total` are deprecated — use `energy-consumption` and `power-consumption` instead.

## Inference rules for expectation selection

Heuristics:
- Deployment expectation: placement/local inference/edge/proximity/privacy-through-locality.
- Sustainability expectation: sustainability/energy/power/joules/watts/carbon/kepler monitoring goals.
- Network expectation: latency/bandwidth/QoS/connectivity guarantees.
- Use multiple expectations when placement, sustainability, and communication quality are all required.
- If only placement cues exist -> deployment-only (state assumption).
- If only sustainability cues exist -> sustainability-only.
- If only communication cues exist -> network-only.
- Keep deployment only if workload exists in catalogue.
- Keep sustainability only if workload exists in catalogue.

Cue mapping:
- “local compute”, “edge”, “run close to me”, “keep data local” -> deployment
- “private dialogue/prompts” -> deployment locality (privacy approximated via local execution)
- “energy efficiency”, “power usage”, “joules”, “watts”, “Kepler metrics” -> sustainability
- “low response time”, “fast replies” -> latency
- “stable/predictable performance” -> likely network QoS (possibly plus locality)
- “high throughput”, “many users”, “large transfer” -> bandwidth
- “symmetric coordination”, “equal weight coordination” -> coordination (symmetric utility profile)
- “weighted coordination”, “prioritize X over Y” -> coordination (weighted utility profile)
- “critical severity”, “strict” -> coordination severity (stricter utility curves)

## Allowed 5G4Data subset

Allowed expectation classes only:
- `data5g:NetworkExpectation`
- `data5g:DeploymentExpectation`
- `data5g:SustainabilityExpectation`
- `data5g:CoordinationExpectation`
- `icm:ObservationReportingExpectation`

Legal combinations:
- network-only
- deployment-only
- sustainability-only
- network + deployment
- deployment + sustainability
- network + sustainability
- network + deployment + sustainability
- deployment + sustainability + coordination (when prompt coordinates deployment and sustainability metrics)
- network + deployment + sustainability + coordination (when coordinated metrics and/or prompt require network QoS)

Never introduce other expectation types.

## Condition restrictions

- Deployment conditions: only from chart `values.yaml` `objectives`.
- Sustainability conditions: only from chart `values.yaml` `sustainability`.
- Network conditions: only bandwidth and latency.
- Logistic behavior allowed only when user explicitly requests soft/non-linear semantics.
- Default operators: `quan:smaller`, `quan:larger`, `quan:inRange`.

## Naming and identifier rules

Use placeholder IDs during generation for intent, all conditions, contexts, expectations, observation reporting expectations, and extra region/helper resources. The package postprocessor will replace placeholders with strict UUIDv4 suffixes.

Naming style:
- `data5g:I__ID_INTENT_1__`
- `data5g:CO__ID_CONDITION_<name>_1__`
- `data5g:CX__ID_CONTEXT_<name>_1__`
- `data5g:DE__ID_DEPLOYMENT_1__`
- `data5g:NE__ID_NETWORK_1__`
- `data5g:SE__ID_SUSTAINABILITY_1__`
- `data5g:CE__ID_COORDINATION_1__`
- `data5g:RE__ID_REPORT_<name>_1__`
- `data5g:RG__ID_REGION_1__`

Rules:
- Use exactly the same placeholder token for all references to the same resource.
- Never reuse one placeholder for different resources.
- Never emit ad-hoc suffixes like `COlatency1...` or `RG1...`; use placeholders only.
- Placeholder labels inside `__ID_...__` must be UPPERCASE letters, digits, and underscores only (for example `__ID_CONDITION_P99_1__`, not `__ID_CONDITION_p99_token_target_1__`).
- Condition resource: `data5g:CO__ID_CONDITION_<LABEL>_1__`.
- Condition-scoped `icm:valuesOfTargetProperty`: `data5g:<metric-stem>___ID_CONDITION_<LABEL>_1__` — reuse the exact same `__ID_CONDITION_<LABEL>_1__` token as the condition; do **not** insert `CO` before the placeholder during generation. Package postprocessing rewrites this to `data5g:<metric-stem>_CO<uuid4>`.

## Local modeling rules

- Root resource is `icm:Intent`.
- Root composition defaults to `log:allOf`; use other logical operators only when explicitly justified.
- Each expectation has exactly one `icm:target`.
- Targets: deployment -> `data5g:deployment`, sustainability -> `data5g:sustainability`, network -> `data5g:network-slice`, observation reporting -> same target it reports on.
- Include one observation reporting expectation per target by default.
- Observation reporting must include `icm:reportDestinations` (default `data5g:graphdb`; use `data5g:prometheus` when the user or runtime context requests Prometheus) and `icm:reportTriggers` with a **per-expectation** event class (never global `TenMinuteReportEventDeployment` shared across intents).
- Event class locals: `{IntervalLabel}ReportEvent{Deployment|Sustainability|Network}_CO<condition-id>` (or `_NE<id>` when no condition). Duration locals: `duration{Kind}_CO<condition-id>` with `time:numericDuration` from runtime reporting interval (default 10 minutes).
- Each event class must include exactly one `imo:eventFor` pointing to the corresponding expectation (`DE`, `SE`, or `NE`).

## Context guidance

Use minimal context needed for the requested intent.

Typical deployment context:
- `data5g:Application`
- `data5g:DataCenter`
- `data5g:DeploymentDescriptor`

Sustainability context guidance:
- Reuse existing complete deployment context when sustainability applies to the same workload/deployment scope.
- Do not create duplicate partial contexts that only repeat `Application`/`DataCenter` without adding required information.

Typical network context:
- `data5g:appliesToCustomer`
- `data5g:appliesToRegion`

Do not invent unsupported context properties. `data5g:DeploymentDescriptor` must come from selected catalogue workload.

## Property naming guidance

- Keep one consistent naming pattern per file.
- Preferred forms during generation (placeholders):
  - bandwidth: `data5g:bandwidth___ID_CONDITION_BANDWIDTH_1__`
  - latency: `data5g:latency___ID_CONDITION_LATENCY_1__`
  - deployment metric: `data5g:<objective-name>___ID_CONDITION_<LABEL>_1__`
- Final form after postprocessing: `data5g:<metric-stem>_CO<uuid4>` (for example `data5g:p99-token-target_COf7f31f2dd17c4cbc91eaa95f1109879b`).

## Validation checklist

Before returning:
- Root is `icm:Intent`.
- Root `log:allOf` references only included expectations/observation reporting expectations.
- Every referenced condition/context is defined exactly once.
- Sustainability should reuse existing complete deployment context when applicable; avoid duplicate partial context resources.
- Deployment conditions are from chart objectives.
- Sustainability conditions are from chart sustainability entries.
- Network conditions only use bandwidth/latency.
- No unsupported expectation classes.
- Expectation targets are correct.
- Observation reporting expectations target the resource they report on.
- Observation reporting uses per-anchor event classes and durations (not global `tenMinutesDeployment` / `TenMinuteReportEventDeployment`) with correct `imo:eventFor` mappings.
- Coordination: when requested, include `data5g:CoordinationExpectation` targeting `data5g:coordination-service` with `ut:utility`, `data5g:coordinates` (the deployment, sustainability, and/or network expectations that own the coordinated metrics), and CE `log:allOf` referencing the **same** existing `data5g:CO…` conditions from those expectations (metrics depend on the workload chart—not a fixed pair; do not create duplicate CE-only conditions). One utility argument `U_arg_<metric-stem>` per coordinated condition. Include `NetworkExpectation` only when coordinated metrics are network-related or the prompt explicitly requests network QoS—not by default. Use `ut:`/`fun:`/`mf:`/`time:` only — never `UtilityFunctions/` IRIs.
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
