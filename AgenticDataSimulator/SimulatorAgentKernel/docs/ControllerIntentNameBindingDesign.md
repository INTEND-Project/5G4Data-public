# Controller Intent Name Binding

## Purpose

Describe how SimulatorController scripts bind logical intent aliases (placeholders in DSL) to runtime intent identifiers created by intent-generation agents.

## Current implementation (as of 2026-07)

Bindings are **in-memory for the duration of a script run** inside SimulatorController.

- DSL: `create intent using <agentAlias> … as <intentAlias>`
- After successful generation, Controller stores `intentAlias → intent_id` (canonical `I…` local id) and related storage hints (e.g. prometheus vs graphdb) in run-local maps.
- Later steps (`request observation-report …`, etc.) resolve the alias from that map.
- Maps are cleared when a new script run starts.
- **Not** persisted to GraphDB, Prisma, or the A2A registry.
- Prisma in SimulatorController holds users, saved scripts, run logs, etc. — not intent aliases.

This matches short-lived lab/demo runs. It does **not** survive Controller restart mid-run or multi-Controller shared state.

### Ownership (current)

| Role | Responsibility |
|------|----------------|
| Intent-generation agent | Create intent Turtle; return identifiers via A2A turn / artifacts |
| Controller | Map script `intentAlias` → runtime `intent_id` for later steps in the same run |

### A2A metadata used with agents

Controller → agent turns carry `metadata.simulator` (e.g. `graphTarget`, observation storage, LLM overrides, reporting intervals). Namespace is **`simulator`**, not a legacy openclaw key.

### Preferred agent selection

UI preferences (`simulator.agentDiscoveryPreferences.v1`) can pin which registered agent name is preferred for intent-agent / observation-agent discovery. That is separate from intent-alias binding.

## Future design (not implemented)

Durable binding was previously designed as GraphDB-authoritative `(runId, logicalName) → (intent_id, intentIri, …)` with Controller-owned writes, cache invalidation, and a thin binding API. That remains a reasonable next step if scripts must survive restarts or multi-Controller operation.

Suggested future fields (unchanged intent):

- `runId`, `logicalName`, `intentLocalId`, `intentRef`, `status`, `creatorAgentId`, timestamps

Example Turtle (illustrative only — not written by Controller today):

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
  data5g:creatorAgentId "5g4data-intent-generating-agent" ;
  dct:created "2026-05-05T06:15:00Z"^^xsd:dateTime .
```

### Why GraphDB binding is still desirable later

Controller-only maps lose state on crash/restart, do not share across Controllers, and are harder to audit. GraphDB (or an equivalent store) remains the preferred long-term source of truth if those requirements appear.

## Related docs

- `MultiagentDataGenerationSimulator.md` — overall architecture (current + future)
- `ReportingAgentDiscovery.md` — how observation agents are discovered (shared agent, not per-intent)
