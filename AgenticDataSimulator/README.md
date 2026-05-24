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
2. Start both simulator agents (from this directory):

   ```bash
   ./agent-control start
   ```

   Other commands: `./agent-control stop`, `./agent-control restart`, `./agent-control --help`

   To run `agent-control` without `./`, add `bin` to your `PATH` once per shell (or add to `~/.bashrc`):

   ```bash
   cd AgenticDataSimulator
   export PATH="$(pwd)/bin:$PATH"
   agent-control start
   ```

3. Use `SimulatorController` to orchestrate multi-agent scripts against registered agents.

Manual load (alternative to `agent-control start`):

1. From `SimulatorAgentKernel`, run `npx tsx src/index.ts package load ../SimulatorAgentPackages/<package-name>`.
2. Run the resulting `SimulatorAgentKernel-<package-name>` clone.

## Authentication

Cloned agents enforce **API key authentication** on HTTP/A2A endpoints (A2A v0.3 `securitySchemes`). Keys are generated on `package load` and synced into `SimulatorController/.env` and `a2a-registry/backend/.env` as `AGENT_API_KEYS`. See [`SimulatorAgentKernel/README.md`](SimulatorAgentKernel/README.md#authentication) for details.

Some shared assets remain under `IntentAgent/` (for example `HermesAgent/`). The kernel system prompt lives at `SimulatorAgentKernel/SYSTEM_PROMPT.md`.
