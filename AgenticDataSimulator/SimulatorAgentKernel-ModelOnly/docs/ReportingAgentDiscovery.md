# Reporting Agent Discovery and Routing

## Purpose

Describe how observation reporting agents are discovered and invoked by SimulatorController.

## Current implementation (as of 2026-07)

### Shared observation agent (not one instance per intent)

There is **one** (or a few) long-lived observation agent(s) per domain, registered in the A2A registry — not a new container per `intent_id`.

Stock example:

| Item | Value |
|------|--------|
| Package folder | `SimulatorAgentPackages/5g4data-intent-observations-generating-agent` |
| Clone | `agents/5g4data-intent-observations-generating-agent/` |
| A2A card name | `5g4data-intent-observation-generating-agent` |
| Local port | **3012** |
| Public base | `https://start5g-1.cs.uit.no/5g4data-intent-observation-generating-agent/` |

LangGraph counterpart (when loaded): `5g4data-intent-observation-langgraph-generating-agent` on port **3032**.

The agent receives the target intent in the control / A2A message (and related metadata), rather than encoding the intent in the public URL path.

### Discovery

1. Controller script: `discover observation-agent by domain … as <alias>` (or UI preferred-agent override).
2. Controller queries `A2A_REGISTRY_BASE_URL` (e.g. `https://start5g-1.cs.uit.no/a2a-registry`).
3. Registry returns the agent card / well-known URI.
4. Controller calls A2A JSON-RPC `message/send` on the agent’s public URL (via Caddy), with `X-Api-Key` from `AGENT_API_KEYS`.

### Caddy routing

Static per-agent path prefixes on `start5g-1.cs.uit.no`, for example:

```text
/5g4data-intent-observation-generating-agent/*  →  host:3012
```

There is **no** dynamic `/agents/{intentId}` router service today. Adding a new agent type requires a Caddy `handle_path` (and port) for that agent name.

### Control / progress APIs

Beyond A2A turns, Controller uses HTTP control routes on the observation agent, typically:

- `GET /v1/observation-progress`
- `GET /v1/observation-errors`

Often pointed at local `OBSERVATION_AGENT_CONTROL_BASE_URL=http://127.0.0.1:3012/v1` for lab use.

### Auth

- `AGENT_API_KEY` on the agent; Controller/registry maps keyed by card name in `AGENT_API_KEYS`.
- Header: `X-Api-Key` (configurable).
- `GET /health` is public; agent-card may be public or key-protected depending on agent version (LangGraph clones currently expose the card for registry fetch).

### Why A2A here

A2A-style cards advertise name, URL, skills/tags (e.g. discovery task for observation-agent). OpenAPI / JSON-RPC define how to invoke turns and control endpoints. Discovery does not replace the invocation contract.

## Future design (not implemented)

Earlier design assumed:

1. One reporting agent **instance per intent**.
2. Card metadata with `intentBinding.intentLocalId` / `intentIri`.
3. Static proxy forwarding `/agents/*` to an **intent-aware router** that resolves `intent_id →` live upstream from the registry.

That model would avoid per-intent Caddy edits and scale to many concurrent intents. It is **not** how the lab runs today; the shared observation agent is the implemented approach.

Illustrative future card shape (not current):

```json
{
  "name": "obs-agent-I5e780…",
  "url": "https://start5g-1.cs.uit.no/agents/I5e780…/v1",
  "intentBinding": {
    "intentLocalId": "I5e780d6c152f42dc991637ad34cd6a62",
    "intentIri": "http://5g4data.eu/5g4data#I5e780d6c152f42dc991637ad34cd6a62"
  }
}
```

## Metric-to-intent notes

Observation control is most reliable when the script already has a logical intent alias / `intent_id`. Metric naming (`<targetProperty>_<conditionId>`) can still be used inside generated data and GraphDB; resolving metrics to intents for routing is package/Controller logic, not a separate router service today.

## Key decisions (current)

1. A2A registry for discovery; OpenAPI/A2A JSON-RPC for invocation.
2. Shared observation agent per domain; intent identity in the message/metadata.
3. Static Caddy `handle_path` per agent card name.
4. Explicit `data5g` / ontology metadata in packages and Turtle, not inferred from opaque ids alone.
