# Controller Intent Name Binding Design

## Purpose

Define how runtime-independent controller scripts bind logical intent names (placeholders used in scripts) to runtime intent identifiers created by intent-generation agents.

This design supports:

- Script portability across runs and environments
- Reliable routing from logical names to intent-specific reporting agents
- Recovery and auditability in multi-agent execution

## Problem Statement

Controller scripts use stable logical names (for example `avalanche-intent`) when declaring:

- intent creation steps
- later reporting/control changes for that same intent and associated metrics

At runtime, intent-generation returns a concrete `intent_id` (for example `I5e780...`) and possibly full `intentIri`.

We need a robust binding mechanism so later script steps can resolve logical names to runtime identifiers.

## Design Summary

Use an external authoritative binding store backed by GraphDB.

- Controller owns logical-name-to-runtime-id bindings.
- Intent-generation agent returns runtime identifiers; it does not own script binding semantics.
- Controller caches bindings in memory for performance, but GraphDB is source of truth.

## Core Decision

### Recommended ownership split

- **Intent-generation agent responsibilities**
  - Create intent
  - Return `intent_id`, `intentIri`, and a request correlation/idempotency key
- **Controller responsibilities**
  - Upsert binding `(runId, logicalName) -> (intent_id, intentIri, metadata)`
  - Resolve binding for subsequent control/reporting steps
  - Drive retries/reconciliation

Reasoning:

- Logical names belong to orchestration logic, not domain generation logic.
- Controller-side ownership improves portability and reduces coupling.
- External persistence survives controller restart and supports multi-controller operation.

## Binding Data Model

Use RDF resources in the `data5g` namespace (or a dedicated binding namespace) to represent bindings.

Suggested fields:

- `logicalName` (script-level handle)
- `runId` (scenario/execution scope)
- `intentLocalId` (for example `I...`)
- `intentRef` (full IRI)
- `status` (`provisioning`, `active`, `failed`, `terminated`)
- `creatorAgentId` (domain-specific stable role id, for example `5g4data-intent-generation-agent`)
- `createdAt`, `updatedAt`
- optional `correlationId` / `creationRequestId`

Example Turtle:

```ttl
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct:    <http://purl.org/dc/terms/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

data5g:binding_run42_avalanche a data5g:IntentBinding ;
  data5g:runId "run42" ;
  data5g:logicalName "avalanche-intent" ;
  data5g:intentLocalId "I5e780d6c152f42dc991637ad34cd6a62" ;
  data5g:intentRef data5g:I5e780d6c152f42dc991637ad34cd6a62 ;
  data5g:status "active" ;
  data5g:creatorAgentId "5g4data-intent-generation-agent" ;
  dct:created "2026-05-05T06:15:00Z"^^xsd:dateTime ;
  dct:modified "2026-05-05T06:15:00Z"^^xsd:dateTime .
```

## End-to-End Flow

### 1) Create intent

1. Controller executes script step: create intent with logical name `X`.
2. Controller discovers/calls intent-generation agent.
3. Agent creates intent and returns `intent_id`, `intentIri`, `creationRequestId`.

### 2) Persist binding

4. Controller upserts GraphDB binding for `(runId, X)`.
5. Status moves from `provisioning` to `active` after successful persistence.

### 3) Use binding

6. Later script step references logical name `X`.
7. Controller resolves `(runId, X)` from cache or GraphDB.
8. Controller uses resolved `intent_id` to discover/report/control the correct intent-specific reporting agent.

## Lookup Strategy

Primary key recommendation:

- `(runId, logicalName)`

Why include `runId`:

- Same logical name can be reused across runs.
- Prevents accidental cross-run collisions.

Secondary lookups:

- by `intent_id` (reverse mapping)
- by status (for cleanup/reconciliation)

## Controller Cache + External Source of Truth

Use a two-layer approach:

- **L1:** in-memory controller cache (fast path)
- **L2:** GraphDB binding store (authoritative)

Cache behavior:

- warm on first lookup
- invalidate on binding updates
- recover from GraphDB on restart

## Failure Handling and Idempotency

### Required protections

- Idempotent create-intent calls (via `creationRequestId`)
- Idempotent binding upsert for `(runId, logicalName)`
- Optimistic concurrency/versioning on updates

### Common failure scenarios

1. **Intent created, binding write fails**
   - retry binding upsert
   - run reconciliation job to detect unbound intents

2. **Binding exists, downstream agent not yet available**
   - retry discovery with backoff
   - keep binding status as `provisioning` until reporting agent registered

3. **Controller restart**
   - rebuild active map from GraphDB by `runId`

## Agent Card / Discovery Integration

Binding service and A2A discovery are complementary:

- Binding maps script logical names to runtime intent identifiers.
- Agent registry maps runtime intent identifiers to reachable reporting agents.

Control path:

1. Resolve logical name -> `intent_id` from GraphDB binding.
2. Resolve `intent_id` -> agent endpoint from registry/router.
3. Send control message to the selected reporting agent.

## API Surface Recommendation

Expose a small binding API in front of GraphDB for controller ergonomics:

- `PUT /bindings/{runId}/{logicalName}` (upsert)
- `GET /bindings/{runId}/{logicalName}` (resolve)
- `GET /bindings?runId=...` (list)
- optional `DELETE /bindings/{runId}/{logicalName}` (cleanup)

Even if controller can query SPARQL directly, a thin API stabilizes contracts and avoids SPARQL coupling in orchestration code.

## Why Not Controller-Only Mapping

Controller-only mapping is acceptable for a short-lived prototype, but has major drawbacks:

- state loss on crash/restart
- poor multi-controller support
- difficult audit/debug/replay
- higher risk of split-brain mappings

Therefore, controller-only should not be the long-term design.

## Optional Alternative

The intent-generation agent could write binding records directly, but this is less preferred because it mixes orchestration semantics into generation responsibilities.

If used, still require:

- returning identifiers to controller
- reconciliation by controller
- explicit ownership and conflict rules

## Final Recommendation

1. Keep binding ownership in controller/orchestrator.
2. Persist bindings in GraphDB as authoritative source.
3. Use `(runId, logicalName)` as the key.
4. Return `intent_id` + `intentIri` + correlation key from generation agent.
5. Combine binding resolution with registry-based agent discovery for runtime control.

This gives a reliable, runtime-independent script model while preserving clean agent responsibility boundaries.
