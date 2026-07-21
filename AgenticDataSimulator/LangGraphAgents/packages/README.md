# LangGraphAgents packages

Domain packages for the LangGraph kernel (folder name = A2A registry / public agent name).

| Package folder | Port | Notes |
|----------------|------|-------|
| `5g4data-intent-langgraph-generating-agent` | **3031** | Intent Turtle generation |
| `5g4data-intent-observation-langgraph-generating-agent` | **3032** | Observation reports + synthetic streams |
| `5g4data-intent-mistral-small4-langgraph-generating-agent` | **3033** | Fragmented generation (`workflow.generation`) |
| `package-template` | — | Scaffold |

Public URLs (default `A2A_AGENT_BASE_URL=https://start5g-1.cs.uit.no`):

- `https://start5g-1.cs.uit.no/5g4data-intent-langgraph-generating-agent/`
- `https://start5g-1.cs.uit.no/5g4data-intent-observation-langgraph-generating-agent/`
- `https://start5g-1.cs.uit.no/5g4data-intent-mistral-small4-langgraph-generating-agent/`

```bash
npx tsx src/index.ts package load ./packages/<package-folder>
```

Clones land in `AgenticDataSimulator/agents/<package-folder>/` (same as stock SimulatorAgentKernel agents).
