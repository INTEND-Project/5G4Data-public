# 5g4data-intent-observations

Domain package for generating TM Forum formatted observation report payloads from an existing intent.

## Scope

- Package-only implementation under `OpenClawPackages/5g4data-intent-observations`.
- Requires runtime capability wiring in `OpenClawAgent` so `intent_id` can be fetched from GraphDB and injected into runtime context.

## Inputs

- Required: `intent_id`
- Optional natural language instructions for runtime behavior
- Optional structured JSON override:
  - `metricValueSpans`
  - `eventRules`
  - `timeWindows`

## Behavior

1. Resolve the intent Turtle by `intent_id`.
2. Identify reportable metrics through `ObservationReportingExpectation` and linked `Condition` statements.
3. Resolve frequency from trigger delay.
4. Apply runtime overrides (time window > event > baseline).
5. Generate TM Forum observation report Turtle payloads.
6. Persist to Prometheus + metadata in GraphDB, or print payloads when `--noGraphDB` is active in loaded clone runtime.

## `--noGraphDB`

When `--noGraphDB` is enabled in the loaded clone runtime:
- GraphDB writes are skipped.
- Generated report payloads are printed in the interactive window.
- Output includes marker: `GraphDB write skipped (--noGraphDB)`.

## Example observation payload

```ttl
@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix data5g: <http://5g4data.eu/5g4data#> .

data5g:OB5ad2a6f39d324f24a4b35fd2a73c0f11 a met:Observation ;
    met:observedMetric data5g:detection-latency_CO282f7522f48b40c797826daa0d964ccc ;
    met:observedValue [ rdf:value 1234.5 ; quan:unit "ms" ] ;
    met:obtainedAt "2026-04-30T08:30:00Z"^^xsd:dateTime .
```
