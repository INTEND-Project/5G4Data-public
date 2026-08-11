# Agentic Implementation of 5G4Data Simulator

We need data, and we therefore want to create a 5G4Data data generation simulator that can give the INTEND project inCoord, inSustain and inExplain the necessary data foundation to make it possible to showcase how these tools could be integrated into the 5G4Data use-case.

We want to experiment with an agentic framework for such a simulator and preferably use European based tech while doing so. The runtime is a custom TypeScript agent kernel (originally inspired by OpenClaw-style package-driven turns) with an optional LangGraph-based reimplementation for orchestration and LangSmith tracing.

The architecture for the simulator is a set of agents that can be controlled by natural language (and structured instructions) and that generate intents, intent status reports and intent observation reports for the 5G4Data use-case. This data together defines a digital observational twin at an intent abstraction level for the 5G4Data use-case.

## Kernels and packages

| Kernel | Role |
|--------|------|
| `SimulatorAgentKernel/` | Stock runtime: turn orchestration, package load, HTTP/A2A API |
| `SimulatorAgentKernel-mistral.small4/` | Experimental fork for fragmented multiturn (mistral-small4 package only) |
| `LangGraphAgents/` | Side-by-side LangGraph + LangSmith reimplementation (same package/clone model) |

Domain behavior lives in packages:

- Stock: `SimulatorAgentPackages/<package-name>/`
- LangGraph: `LangGraphAgents/packages/<package-name>/`

The kernel handles reusable agent mechanics (turns, model invocation, validation/repair, package loading, A2A). Packages provide prompts, rules, workflows, tools, validators, and agent-card metadata.

## Clone layout (current)

`package load` creates a runnable clone under:

```text
AgenticDataSimulator/agents/<package-name>/
```

not `SimulatorAgentKernel-<package-name>/` (legacy naming; ignored by git).

Typical stock ports (from package `mappings/env.defaults.json` / `agent-control`):

| Package folder | Public / A2A name (card) | Port |
|----------------|--------------------------|------|
| `5g4data-intent-generating-agent` | `5g4data-intent-generating-agent` | 3011 |
| `5g4data-intent-observations-generating-agent` | `5g4data-intent-observation-generating-agent` | 3012 |
| `5g4data-intent-mistral-small4-generating-agent` | `5g4data-intent-mistral-small4-generating-agent` | 3013 |

LangGraph packages use distinct names and ports **3031–3033** (see `LangGraphAgents/packages/README.md`).

## Benefits of separating generic and domain functionality

- **Faster domain onboarding:** New domain agents are created by authoring a package, not by re-implementing core orchestration.
- **Consistency across agents:** All domain agents inherit the same runtime behavior, auth, and validation patterns.
- **Lower maintenance cost:** Core improvements happen once in the kernel and benefit every package-based agent.
- **Safer evolution:** Domain logic changes remain isolated in package artifacts.
- **Side-by-side experimentation:** LangGraphAgents can evolve orchestration without replacing stock agents.

Creating a domain-specific agent is primarily a packaging task: define behavior in the package tree, `package load` into `agents/<package-name>/`, register with the A2A registry, and route via Caddy under `https://start5g-1.cs.uit.no/<agent-card-name>/`.
