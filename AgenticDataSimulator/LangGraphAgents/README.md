# LangGraphAgents

TypeScript LangGraph kernel for package-based 5G4Data intent agents, with **LangSmith** as the primary observability plane.

This tree is a side-by-side reimplementation of `SimulatorAgentKernel`. Existing `SimulatorAgentKernel` / `SimulatorAgentPackages` are unchanged reference implementations. Domain packages live under [`packages/`](packages/).

## Architecture

- **Kernel** (`src/`): LangGraph turn graph, A2A/HTTP control API, package load → clones
- **Packages** (`packages/`): declarative domain behavior (workflow DSL, prompts, validators, tools)
- **Clones**: `../agents/<package-name>/` created by `package load` (same layout as SimulatorAgentKernel)

Turn pipeline (LangGraph nodes):

`replHook → confirm → classify → context → prompt → generate → repair → postprocess → shacl → persist → finalize`

Fragmented generation (mistral-small4 package) runs inside the `generate` node when `workflow.generation.mode === "fragmented"` and the user confirms.

## Install

```bash
cd LangGraphAgents
cp .env.example .env   # fill OPENAI_API_KEY / LANGSMITH_API_KEY as needed
npm install
```

## LangSmith

Set in `.env`:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=5g4data-intent-langgraph-generating-agent
LANGCHAIN_CALLBACKS_BACKGROUND=true
```

Each agent turn exports an `agent_turn` chain with nested LLM/tool spans (context, repair, SHACL, GraphDB, fragments). Tags include `package.name`, intent flags, SHACL/GraphDB outcomes, and `generation.mode`.

Turn/A2A responses may include `langsmithTraceId` (and deprecated alias `mlflowTraceId` for older clients).

## Run CLI (baseline, no clone)

```bash
# one-shot
npx tsx src/index.ts --debug "I want a small llm near Tromsø"

# interactive
npx tsx src/index.ts --debug
```

## Package load → Controller-ready clone

```bash
npx tsx src/index.ts package load ./packages/5g4data-intent-langgraph-generating-agent
# observations:
npx tsx src/index.ts package load ./packages/5g4data-intent-observation-langgraph-generating-agent
# mistral fragmented:
npx tsx src/index.ts package load ./packages/5g4data-intent-mistral-small4-langgraph-generating-agent

# filesystem clone only:
npx tsx src/index.ts package load --no-container ./packages/5g4data-intent-langgraph-generating-agent
```

This creates `../agents/<package-name>/`, mints `AGENT_API_KEY`, syncs keys into SimulatorController / a2a-registry when present, and optionally starts Docker.

Default ports (from package `mappings/env.defaults.json`): intent **3031**, observations **3032**, mistral **3033** (stock agents keep 3011–3013).

## A2A / SimulatorController cutover checklist

1. Load packages into LangGraphAgents clones (ports 3031/3032).
2. Confirm `curl -H "X-Api-Key: $AGENT_API_KEY" http://127.0.0.1:3031/.well-known/agent-card.json`.
3. Point Controller agent base URLs / registry entries at the new clones (same A2A `message/send` + `metadata.simulator` as before).
4. Verify workload-preview and observation-progress routes if using those Controller features.
5. Open LangSmith project for the package and confirm `agent_turn` traces per request.

## Tests

```bash
npm run check
npm run test:dev
```

## Smoke (LangSmith)

```bash
npm run smoke
```

Requires `OPENAI_API_KEY` and optionally `LANGSMITH_API_KEY` with tracing enabled.
