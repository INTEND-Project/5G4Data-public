---
name: OpenClaw client-server and discovery architecture
overview: "Unified architecture for API transport, A2A-style agent discovery, reverse-proxy routing, and GraphDB-backed logical-name binding for intent-specific agents."
todos:
  - id: api-contract-v1
    content: "Publish OpenAPI v1 for sessions/turns + minimal package metadata routes"
    status: pending
  - id: registry-contract
    content: "Define agent-card registration + heartbeat/TTL schema for discovery"
    status: pending
  - id: binding-contract
    content: "Define GraphDB binding vocabulary and thin binding API"
    status: pending
  - id: router-service
    content: "Implement intent-aware router behind start5g-1 reverse proxy"
    status: pending
  - id: ops-hardening
    content: "Add auth, rate limits, correlation IDs, retries, and reconciliation jobs"
    status: pending
isProject: false
---

# SimulatorAgentKernel client-server and discovery architecture

## Executive summary

This architecture extends the original API plan with runtime discovery and binding:

- Keep a thin, versioned HTTP API around `TurnOrchestrator.runTurn(session, userText)`.
- Use A2A-style agent cards for discovery and capability advertisement.
- Run a stable reverse proxy on `start5g-1.cs.uit.no` and route dynamically via a router service.
- Persist logical-name-to-intent bindings in GraphDB as authoritative state.

This enables runtime-independent controller scripts to create intents using logical names and later send control messages to the correct intent-specific reporting agent.

## Current state

- OpenClaw runtime is CLI-first, centered on `TurnOrchestrator.runTurn(...)`.
- Domain behavior is package-driven under `SimulatorAgentPackages`.
- Observation reporting package supports natural-language and structured override behavior.
- No production-ready built-in server for discovery, routing, and binding lifecycles yet.

## Architecture goals

1. Decouple controller scripts from runtime-generated `intent_id` values.
2. Support one reporting agent per intent and dynamic agent lifecycles.
3. Avoid static reverse-proxy edits per new agent instance.
4. Provide durable, auditable binding state across controller restarts.
5. Keep invocation contracts explicit and versioned (OpenAPI).

## Non-goals

- Defining a universal cross-platform "agent control protocol."
- Moving package/domain semantics into the discovery layer.
- Replacing OpenAPI transport contracts with discovery metadata.

## System components

### 1) Controller

- Executes runtime-independent scripts with logical intent names.
- Discovers intent-generation and reporting agents.
- Writes and resolves logical-name bindings.

### 2) Intent-generation agent (`5g4data-intent-generation`)

- One agent per domain/use-case.
- Registers an agent card at startup.
- Creates intents and returns `intent_id` + `intentIri` + correlation/idempotency key.

### 3) Observation reporting agents (`5g4data-intent-observations`)

- One agent instance per created intent.
- Register cards with explicit `intentBinding`.
- Receive control messages for reporting behavior.

### 4) Registry (A2A-style discovery)

- Stores agent cards with TTL/heartbeat.
- Supports lookup by capability/domain and by `intent_id`.

### 5) Binding service (GraphDB-backed)

- Authoritative mapping for `(runId, logicalName) -> (intent_id, intentIri, metadata)`.
- Exposed through a small controller-facing API (or direct SPARQL if needed).

### 6) Reverse proxy + router

- Reverse proxy endpoint: `start5g-1.cs.uit.no`.
- Static top-level config forwards `/agents/*` to router.
- Router resolves current target from registry and proxies dynamically.

## End-to-end flows

### A) Intent creation with binding

1. Controller script requests creation for logical name `X`.
2. Controller discovers intent-generation agent card.
3. Controller calls generation API.
4. Agent returns `intent_id`, `intentIri`, `creationRequestId`.
5. Controller upserts GraphDB binding for `(runId, X)`.

### B) Reporting control using logical name

1. Script step references logical name `X`.
2. Controller resolves `X` to `intent_id` via binding service/cache.
3. Controller (or router) discovers reporting agent by `intent_id`.
4. Controller sends control request through gateway.
5. Router forwards to resolved reporting agent endpoint.

### C) Metric-driven control

If a script references a metric:

1. Parse/extract `conditionId` from metric naming (`<targetProperty>_<conditionId>`).
2. Resolve `conditionId -> intent_id` from graph/index.
3. Continue with intent-based discovery/routing.

## Discovery model (A2A-style cards)

Use discovery cards for advertisement and lookup, not as the full invocation contract.

Recommended card metadata:

- `agentId`, `capabilities`, `domain.useCase`
- `domain.ontologyNamespace` (for 5G4Data: `http://5g4data.eu/5g4data#`)
- `intentBinding.intentLocalId` and `intentBinding.intentIri` (for reporting agents)
- endpoint base URL and OpenAPI URL
- auth requirements

## Binding model (GraphDB authoritative store)

### Ownership decision

- Intent-generation agent creates intents.
- Controller owns logical-name binding writes.

Rationale:

- Logical names are orchestration concerns.
- Works across controller restarts and multi-controller setups.
- Reduces coupling between generation and orchestration policies.

### Keying

Primary key: `(runId, logicalName)`

This prevents cross-run collisions when logical names are reused.

### Suggested binding fields

- `runId`
- `logicalName`
- `intentLocalId`
- `intentRef` (IRI)
- `status` (`provisioning`, `active`, `failed`, `terminated`)
- `creatorAgentId` (domain-specific stable role id, e.g. `5g4data-intent-generation-agent`)
- timestamps and correlation/idempotency fields

## API layers

### Invocation API (OpenAPI v1)

- `POST /v1/sessions`
- `POST /v1/sessions/{id}/turns`
- Optional package metadata GET endpoints

### Discovery API

- register card
- heartbeat/lease renewal
- lookup by capability/domain
- lookup by `intent_id`

### Binding API

- `PUT /bindings/{runId}/{logicalName}` (upsert)
- `GET /bindings/{runId}/{logicalName}` (resolve)
- `GET /bindings?runId=...` (list)
- optional delete/cleanup route

## Reverse proxy and router design

### Reverse proxy (Caddy)

- Keep config static (no per-agent updates).
- Terminate TLS and enforce edge auth.
- Forward `/agents/*` to router service.

### Router

- Validate request and extract `intent_id` context.
- Resolve target agent from registry.
- Proxy request and return normalized errors for missing/stale/unhealthy targets.

## Reliability and operations

- TTL + heartbeat to expire dead agent cards.
- Idempotent intent creation and binding upserts.
- Per-session in-flight turn control.
- Retries with backoff for discovery and routing.
- Reconciliation job for:
  - intents without bindings
  - bindings without active reporting agents
- Correlation IDs across controller, registry, router, and agents.

## Trade-offs and choices

- **A2A for discovery, OpenAPI for invocation:** best separation of concerns.
- **GraphDB as binding source of truth:** stronger durability/audit/queryability than controller-only memory.
- **Controller-owned binding:** cleaner responsibility boundaries than generation-agent-owned binding.
- **Static proxy + dynamic router:** avoids operational overhead of per-agent proxy edits.

## Phased implementation

### Phase 1 (core API and discovery)

- Implement OpenAPI v1 endpoints around orchestrator.
- Add registry with agent-card registration and lookup.
- Add router service behind `start5g-1.cs.uit.no`.

### Phase 2 (binding and control hardening)

- Implement GraphDB binding model and binding API.
- Add idempotency, retries, reconciliation, and structured error taxonomy.

### Phase 3 (scalability and advanced behavior)

- External session store and horizontal scaling.
- Streaming responses where needed.
- Policy-driven routing/security enhancements.

## Final architecture decision

Adopt a combined pattern:

1. Thin OpenClaw HTTP API for invocation.
2. A2A-style card registry for discovery.
3. GraphDB-backed binding service for logical name resolution.
4. Static reverse proxy with dynamic intent-aware router.

This satisfies runtime-independent controller scripting while preserving clear separation between domain logic, discovery, and transport contracts.
