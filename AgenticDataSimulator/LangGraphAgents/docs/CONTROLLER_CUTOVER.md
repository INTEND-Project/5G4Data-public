# SimulatorController cutover checklist (LangGraphAgents)

Use this after loading intent + observations packages into LangGraphAgents clones.

## 1. Load clones

From `LangGraphAgents/`:

```bash
npx tsx src/index.ts package load ./packages/5g4data-intent-langgraph-generating-agent
npx tsx src/index.ts package load ./packages/5g4data-intent-observation-langgraph-generating-agent
# optional fragmented path
npx tsx src/index.ts package load ./packages/5g4data-intent-mistral-small4-langgraph-generating-agent
```

Expect siblings:

- `../agents/5g4data-intent-langgraph-generating-agent` (port **3031**)
- `../agents/5g4data-intent-observation-langgraph-generating-agent` (port **3032**)
- optional mistral clone (port **3033**)

Registry / public agent names and ports (distinct from SimulatorAgentKernel 3011–3013):

| Clone package | A2A card name / URL slug | Port |
|---------------|--------------------------|------|
| intent generating | `5g4data-intent-langgraph-generating-agent` | 3031 |
| observations | `5g4data-intent-observation-langgraph-generating-agent` | 3032 |
| mistral-small4 | `5g4data-intent-mistral-small4-langgraph-generating-agent` | 3033 |

`package load` mints `AGENT_API_KEY` and syncs `AGENT_API_KEYS` into `SimulatorController/.env` and `a2a-registry` under those card names when those trees are present.

## 2. Health + agent card

```bash
curl -sS http://127.0.0.1:3031/health
curl -sS -H "X-Api-Key: $AGENT_API_KEY" \
  http://127.0.0.1:3031/.well-known/agent-card.json | head
# After Caddy reload, public card:
# https://start5g-1.cs.uit.no/5g4data-intent-langgraph-generating-agent/.well-known/agent-card.json
```

## 3. Point Controller at new agents

- Update Controller / registry base URLs to the LangGraphAgents clone endpoints (same A2A JSON-RPC `message/send` contract).
- Keep sending `metadata.simulator` (graphTarget, storage, LLM overrides, reporting intervals) — adapters are unchanged.
- Workload preview: `POST /v1/control/workload-preview`
- Observations: `GET /v1/observation-progress`, `GET /v1/observation-errors`

No Controller code changes are required if URLs and API keys are updated.

## 4. LangSmith

On each clone `.env`:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=<package-or-clone-name>
LANGCHAIN_CALLBACKS_BACKGROUND=true
```

After a Controller turn, open the LangSmith project and confirm an `agent_turn` chain with nested LLM/tool spans. Response metadata may include `langsmithTraceId` (and deprecated `mlflowTraceId` alias).

## 5. Smoke without Controller

```bash
cd LangGraphAgents
NO_GRAPHDB=true API_SERVER_ENABLED=false npm run smoke
```
