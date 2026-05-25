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
## Agent logs on the host

Each running agent container bind-mounts its log directory to the corresponding clone directory on the host:

| Agent | Host log directory |
|-------|-------------------|
| Intent generation | `SimulatorAgentKernel-5g4data-intent-generating-agent/logs/` |
| Observations | `SimulatorAgentKernel-5g4data-intent-observation-generating-agent/logs/` |

Agents are started with `--debug`, so you will typically see files such as `openclaw-agent-debug.jsonl` there (and additional observation logs under the observations agent clone).

To **stop** writing logs to the host filesystem, remove the bind mount from that agent's `docker-compose.yml`:

```yaml
    volumes:
      - ./logs:/app/logs
```

Then recreate the container (for example `./agent-control restart` or `docker compose up -d --force-recreate` in the clone directory). Logs will remain inside the container only unless you also remove `--debug` from the `command` in the same file.

## Authentication

Cloned agents enforce **API key authentication** on HTTP/A2A endpoints (A2A v0.3 `securitySchemes`). Keys are generated on `package load` and synced into `SimulatorController/.env` and `a2a-registry/backend/.env` as `AGENT_API_KEYS`. See [`SimulatorAgentKernel/README.md`](SimulatorAgentKernel/README.md#authentication) for details.

Some shared assets remain under `IntentAgent/` (for example `HermesAgent/`). The kernel system prompt lives at `SimulatorAgentKernel/SYSTEM_PROMPT.md`.

#  Manual load agents
This is an alternative way to start agents manually.

1. From `SimulatorAgentKernel`, run `npx tsx src/index.ts package load ../SimulatorAgentPackages/package-name` (package-name is the name of the package folder, e.g. 5g4data-intent-generation).
2. Install node packages: (e.g. *cd ../clone-name* and *npm install* where clone-name is the resulting clone folder, e.g. SimulatorAgentKernel-5g4data-intent-generating-agent)
2. Run the resulting clone form the clone-folder (e.g.  *npx tsx src/index.ts --debug*).


