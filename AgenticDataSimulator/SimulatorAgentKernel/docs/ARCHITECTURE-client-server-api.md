---
name: Simulator client-server and discovery architecture
overview: "HTTP/A2A transport, registry discovery, Caddy routing, and Controller scripting for package-based simulator agents."
isProject: false
---

# Client-server and discovery architecture

## Executive summary

The lab stack combines:

- Package-based agent kernels (`SimulatorAgentKernel`, optional `LangGraphAgents`) exposing HTTP + A2A JSON-RPC.
- An A2A registry for agent-card discovery.
- Caddy on `start5g-1.cs.uit.no` with **static** path prefixes per agent card name.
- SimulatorController (Next.js) running scripts that discover agents, create intents, and request observation reports.

Logical intent aliases are resolved **in Controller memory for the script run**. GraphDB-backed binding and an intent-aware `/agents/{intentId}` router remain **future** work.

## Current state (as of 2026-07)

| Area | Status |
|------|--------|
| Kernel HTTP API + A2A `message/send` | Implemented |
| Agent cards at `/.well-known/agent-card.json` | Implemented |
| Registry register/lookup | Implemented (`a2a-registry`) |
| API key auth (`X-Api-Key` / `AGENT_API_KEYS`) | Implemented |
| Caddy public paths `/<agent-card-name>/` | Implemented (static) |
| Controller script DSL + preferred agents | Implemented |
| Shared observation agent | Implemented |
| In-memory intent aliases in script runs | Implemented |
| Dynamic intent router `/agents/{intentId}` | **Not** implemented |
| One reporting agent per intent | **Not** implemented |
| GraphDB authoritative intent-name binding API | **Not** implemented |

## System components

### 1) SimulatorController

- Prod **:3000**, lab/dev **:3001** (often under `/tmf-simulator` / `/tmf-simulator-dev`).
- Discovers intent / observation agents via registry (optional preferred agent name from UI).
- Runs DSL scripts: `discover …`, `create intent … as <alias>`, `request observation-report …`.
- Sends A2A turns with `metadata.simulator` (graph target, storage, LLM overrides, reporting intervals).
- Progress/errors for observations via `/v1/observation-progress` and `/v1/observation-errors`.

### 2) Intent-generation agents

Examples:

- Stock: `5g4data-intent-generating-agent` (:3011)
- Mistral fragmented: `5g4data-intent-mistral-small4-generating-agent` (:3013)
- LangGraph: `5g4data-intent-langgraph-generating-agent` (:3031)

One long-lived instance per package clone. Registers card at startup. Creates intents from NL (+ Controller metadata).

### 3) Observation reporting agents

Shared long-lived instance (e.g. `5g4data-intent-observation-generating-agent` :3012). Not spawned per intent. Target intent is supplied in the control/A2A payload.

### 4) Registry (A2A)

- Base URL e.g. `https://start5g-1.cs.uit.no/a2a-registry`
- Agents register with `wellKnownURI` pointing at the public card URL
- Controller discovers by domain / skill tags / preferred name

### 5) Reverse proxy (Caddy)

- TLS termination for `start5g-1.cs.uit.no`
- Per-agent `handle_path /<card-name>/*` → `host.docker.internal:<port>`
- New agent types need a new path + port (no dynamic router yet)

### 6) Kernels and packages

- Stock packages: `SimulatorAgentPackages/`
- LangGraph packages: `LangGraphAgents/packages/`
- Clones: `agents/<package-folder>/` via `package load`

## End-to-end flows (current)

### A) Intent creation

1. Script discovers intent agent (registry + optional preferred name).
2. Opens A2A session; user/Controller dialog may confirm plan (`OK`).
3. Agent emits Turtle; may persist to GraphDB per metadata / env.
4. Controller binds `intentAlias → intent_id` in run-local memory.

### B) Observation reporting

1. Script discovers observation agent.
2. `request observation-report` for a logical alias / intent id (resolved from run maps).
3. Shared observation agent generates streams; Controller polls progress/errors APIs.
4. Datapoints go to GraphDB and/or Prometheus per `icm:reportDestinations` / script storage.

## Invocation and discovery contracts

### Invocation

- A2A JSON-RPC `message/send` (primary Controller path)
- OpenAPI at `/openapi.json`; health at `/health`
- Optional control extensions (workload preview, observation progress/errors)

### Discovery

- Agent cards (A2A v0.3-style fields used in this lab)
- Registry register + list/discover APIs
- Lookup by domain / capabilities / preferred agent **name**, not by `intent_id` → dedicated instance

### Auth

- Agent: `AGENT_API_KEY`
- Controller / registry consumers: `AGENT_API_KEYS` JSON map keyed by card name
- Header: `X-Api-Key` (default)

## Future work (still valid goals)

1. GraphDB-backed `(runId, logicalName)` binding with Controller-owned upserts.
2. Optional intent-aware router so reporting instances can register without new Caddy paths.
3. Optional one reporting agent per intent if concurrency/isolation requires it.
4. Stronger correlation IDs, rate limits, and reconciliation jobs.

See also: `ControllerIntentNameBindingDesign.md`, `ReportingAgentDiscovery.md`, `LangGraphAgents/docs/CONTROLLER_CUTOVER.md`.
