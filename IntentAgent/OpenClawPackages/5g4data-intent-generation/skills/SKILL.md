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
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
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
    dct:description "<objective-name> condition quan:smaller: <value><unit>" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:<objective-name>_CO<same-uuid4> ;
            quan:smaller [ quan:unit "<unit>" ;
                    rdf:value <value> ] ] .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "Bandwidth condition quan:larger: <value>mbit/s" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth_CO<same-uuid4> ;
            quan:larger [ quan:unit "mbit/s" ;
                    rdf:value <value> ] ] .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "Latency condition quan:smaller: <value>ms" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:networklatency_CO<same-uuid4> ;
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

data5g:tenMinutesDeployment a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventDeployment a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:tenMinutesDeployment ) ;
    imo:eventFor data5g:DE<uuid4> .

data5g:RE<uuid4> a icm:ObservationReportingExpectation ;
    dct:description "Deployment observation reports every 10 minutes." ;
    icm:target data5g:deployment ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventDeployment ] .

data5g:tenMinutesSustainability a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventSustainability a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:tenMinutesSustainability ) ;
    imo:eventFor data5g:SE<uuid4> .

data5g:RE<uuid4> a icm:ObservationReportingExpectation ;
    dct:description "Sustainability observation reports every 10 minutes." ;
    icm:target data5g:sustainability ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventSustainability ] .

data5g:tenMinutesNetwork a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventNetwork a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:tenMinutesNetwork ) ;
    imo:eventFor data5g:NE<uuid4> .

data5g:RE<uuid4> a icm:ObservationReportingExpectation ;
    dct:description "Network observation reports every 10 minutes." ;
    icm:target data5g:network-slice ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventNetwork ] .
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
- Query GraphDB at `https://start5g-1.cs.uit.no/graphdb/`, graph `http://intendproject.eu/telenor/infra`.
- Use SPARQL nearest edge data center for `data5g:DataCenter`.
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

## Sustainability condition extraction from Helm charts

Rules:
- Read `sustainability` in selected chart `values.yaml`.
- Create one sustainability condition per entry unless user narrows scope.
- Metric stem is metric `name`, suffixed with `_<condition-id>`.
- Use user-provided threshold when available; otherwise use `tmf-value-hint`, then `value`.
- Preserve `measuredBy` from chart entries whenever present.
- If no reliable sustainability metrics exist, ask follow-up or mark sustainability-condition generation out-of-scope.

Example:

```yaml
sustainability:
  - name: kepler_container_cpu_watts
    value: 0.0
    tmf-value-hint: 10000
    measuredBy: intend/container_cpu_watts
```

Use metric `data5g:kepler_container_cpu_watts_<condition-id>`.

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

## Allowed 5G4Data subset

Allowed expectation classes only:
- `data5g:NetworkExpectation`
- `data5g:DeploymentExpectation`
- `data5g:SustainabilityExpectation`
- `icm:ObservationReportingExpectation`

Legal combinations:
- network-only
- deployment-only
- sustainability-only
- network + deployment
- deployment + sustainability
- network + sustainability
- network + deployment + sustainability

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
- `data5g:RE__ID_REPORT_<name>_1__`
- `data5g:RG__ID_REGION_1__`

Rules:
- Use exactly the same placeholder token for all references to the same resource.
- Never reuse one placeholder for different resources.
- Never emit ad-hoc suffixes like `COlatency1...` or `RG1...`; use placeholders only.
- Use condition-scoped property suffixes (`_<condition-id>`).

## Local modeling rules

- Root resource is `icm:Intent`.
- Root composition defaults to `log:allOf`; use other logical operators only when explicitly justified.
- Each expectation has exactly one `icm:target`.
- Targets: deployment -> `data5g:deployment`, sustainability -> `data5g:sustainability`, network -> `data5g:network-slice`, observation reporting -> same target it reports on.
- Include one observation reporting expectation per target by default.
- Observation reporting must include `icm:reportDestinations` to `data5g:prometheus` and `icm:reportTriggers` with a target-specific TenMinute event.
- Each TenMinute event must include `imo:eventFor` pointing to the corresponding expectation (`DE`, `SE`, or `NE`).

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
- Preferred forms:
  - bandwidth: `data5g:bandwidth_<condition-id>`
  - latency: `data5g:networklatency_<condition-id>`
  - deployment metric: `data5g:<objective-name>_<condition-id>`

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
- Observation reporting uses target-specific TenMinute events with correct `imo:eventFor` mappings.
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
