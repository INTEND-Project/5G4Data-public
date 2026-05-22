# AgenticDataSimulator

Multi-agent data generation simulator stack for the 5G4Data project.

## Components

| Directory | Role |
|-----------|------|
| `SimulatorAgentKernel` | Generic runtime kernel; loads domain packages and creates package-bound agent clones |
| `SimulatorAgentPackages` | Domain package registry (intent generation, observations, templates) |
| `SimulatorController` | Web workspace for script authoring, agent discovery, and execution |
| `a2a-registry` | Agent-to-agent registry for discovery and registration |

See also [`README-a2a-registry.md`](README-a2a-registry.md) for deployment and Caddy/UFW integration notes.

## Typical workflow

1. Author or extend a package under `SimulatorAgentPackages/`.
2. From `SimulatorAgentKernel`, run `npx tsx src/index.ts package load ../SimulatorAgentPackages/<package-name>`.
3. Run the resulting `SimulatorAgentKernel-<package-name>` clone.
4. Use `SimulatorController` to orchestrate multi-agent scripts against registered agents.

Some shared assets remain under `IntentAgent/` (for example `HermesAgent/`). The kernel system prompt lives at `SimulatorAgentKernel/SYSTEM_PROMPT.md`.
