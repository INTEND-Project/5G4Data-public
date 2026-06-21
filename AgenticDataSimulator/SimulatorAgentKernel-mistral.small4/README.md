# SimulatorAgentKernel-mistral.small4

**E1 experimental kernel** — fragmented multiturn intent generation. Use only with `5g4data-intent-mistral-small4-generating-agent`. Do **not** use for core agents (`5g4data-intent-generation`, observations).

Stock kernel: `../SimulatorAgentKernel` (unchanged).

TypeScript-first OpenClaw kernel for package-based intent agents.

Runtime clones: `../agents/<package-directory-name>` (or `-iN` iteration suffix via `PACKAGE_LOAD_ITERATION`).

Related guide:

- Package authoring and structure: `../SimulatorAgentPackages/README.md`

## What is implemented

- Domain package kernel with declarative package loading (`src/core/packageLoader.ts`, `src/core/workflowEngine.ts`)
- Package-driven orchestration (`src/core/turnOrchestrator.ts`)
- Package-provided domain tools loaded at runtime from the active package
- Output policy validation + repair loop (`src/core/outputPolicyValidator.ts`, `src/core/repairEngine.ts`)
- SHACL validation via `rdf-validate-shacl` plus SPARQL coverage checks (`src/core/shaclValidatorTool.ts`)
- OpenAI/Anthropic integration adapter (`src/adapters/openclaw.ts`)
- A2A v0.3 API key authentication on the HTTP control API (agent card, OpenAPI, JSON-RPC, REST sessions); `GET /health` stays public

## Install

```bash
cd SimulatorAgentKernel
npm install
```

## Agent lifecycle (important)

- `SimulatorAgentKernel`: baseline kernel used to load packages.
- `SimulatorAgentPackages/<package-name>`: domain behavior package.
- `SimulatorAgentKernel-<package-name>`: resulting concrete agent instance you actually run.

In normal usage, you create/update agents from this kernel, then run the cloned agent instance.

## Create `SimulatorAgentKernel-<package-name>` instances

```bash
# 1) install deps in kernel
cd SimulatorAgentKernel
npm install

# 2) create/update an agent instance from a package (builds and starts a Docker container)
npx tsx src/index.ts package load ../SimulatorAgentPackages/5g4data-intent-generating-agent

# 3) the clone runs in Docker; check health and logs
curl http://127.0.0.1:3011/health
cd ../SimulatorAgentKernel-5g4data-intent-generation && docker compose logs -f
```

Skip container startup (filesystem clone only, for CI or hosts without Docker):

```bash
npx tsx src/index.ts package load --no-container ../SimulatorAgentPackages/5g4data-intent-generation
# or: CONTAINER_LOAD=false npx tsx src/index.ts package load ../SimulatorAgentPackages/...
```

You can also load from archive:

```bash
npx tsx src/index.ts package load /path/to/my-package.tgz
```

## Run the resulting agent

By default, `package load` builds and starts the clone as a **Docker container** with the host port from `API_SERVER_PORT` in the clone `.env` (package `mappings/env.defaults.json` may set this, e.g. **3011** or **3012**).

```bash
cd ../SimulatorAgentKernel-5g4data-intent-generation
docker compose logs -f
docker compose restart
```

**Host fallback** (no container, or after `--no-container` load):

```bash
# one-shot
npx tsx src/index.ts "I want to experiment with a small llm in a datacenter near Tromsø/Norway"

# interactive debug mode
npx tsx src/index.ts --debug
```

## Debug mode (in cloned agent)

Enable debug logging for full per-turn diagnostics (including generated Turtle candidates, validation issues, and SHACL reports):

```bash
# Interactive with debug log at default path
npx tsx src/index.ts --debug

# One-shot with debug
npx tsx src/index.ts --debug "I am going to use a drone to search for skiers that might have been caught in an avalange near Bodø/Norway. I need an object detection model deployed locally and good network connection for sending 4K video to the model in near realtime."

# Custom debug log path
npx tsx src/index.ts --debug logs/my-debug.jsonl
```

Default debug log file:

- `logs/openclaw-agent-debug.jsonl`

## Environment variables

- `LLM_PROVIDER`: `openai` or `anthropic`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`
- `OPENCLAW_MODEL`
- `DOMAIN_PACKAGE_DIR` (defaults to `../SimulatorAgentPackages/5g4data-intent-generating-agent`)
- `LLM_USAGE_LOG_PATH` (optional JSONL file for per-intent token/cost summaries)
- `WORKLOAD_CATALOG_BASE_URL`
- `GRAPHDB_ENDPOINT`, `GRAPHDB_NAMED_GRAPH`, `GRAPHDB_QUERY_LIMIT`, `GRAPHDB_CONTEXT_LIMIT`
- `DEFAULT_INTENT_HANDLER`, `DEFAULT_INTENT_OWNER`, `AUTO_GENERATE_DESCRIPTION`
- `SKILL_FILE`, `SYSTEM_PROMPT_FILE` (defaults to `./SYSTEM_PROMPT.md` in the kernel; optional compatibility layer — package prompts are primary)
- `SHACL_SHAPES_FILE`, `SHACL_MAX_RETRIES`
- `API_SERVER_ENABLED`, `API_SERVER_HOST`, `API_SERVER_PORT` (overridden for this process by CLI `--port <n>` when given)
- `A2A_ENABLED`, `A2A_REGISTRY_BASE_URL`, `A2A_AGENT_BASE_URL`, `A2A_AGENT_CARD_PATH`, `A2A_AUTO_REGISTER_ON_STARTUP`
- `AGENT_API_KEY`, `AGENT_API_KEY_HEADER` (default header: `X-Api-Key`; see [Authentication](#authentication))
- `MLFLOW_TRACKING_URI`, `MLFLOW_EXPERIMENT_NAME` or `MLFLOW_EXPERIMENT_ID`, `MLFLOW_TRACING_ENABLED`, `MLFLOW_TRACKING_STORE_EXPORT_ENABLED` (optional judge-ready tracing; see [MLflow tracing](#mlflow-tracing) and [README-MLFLOW.md](../README-MLFLOW.md))

## MLflow tracing

Full architecture (storage, online/offline judges, Docker networking): [README-MLFLOW.md](../README-MLFLOW.md).

When `MLFLOW_TRACKING_URI` is set, each agent turn is exported to MLflow as a trace with:

- Root **AGENT** span (`agent_turn`) with user input, final response, session/turn IDs, and previews for the Traces list
- Nested **LLM** spans per model call (`main_turn`, `repair`, …) with token usage
- **TOOL** spans for SHACL validation and GraphDB persistence
- Tags for `agent.name`, `package.name`, `turn.path` (`llm_turn` vs `repl_package_hook`)

Package defaults in `SimulatorAgentPackages/*/mappings/env.defaults.json` create **one experiment per clone** (for example `5g4data-intent-generating-agent`). Before each agent turn, the kernel re-checks the named experiment. If you soft-deleted it in the MLflow UI, the kernel restores it; if it is gone entirely, the kernel creates a new one.

Provision programmatic online judges (YAML + `provision-judges.mjs`) from [`mlflow/judges/`](../mlflow/judges/README.md). Offline judges post assessments to the same traces after Controller `store-intent` or observation `completed`.

Spans are dual-exported: artifacts (`traces.json`) for the UI plus OTLP to Postgres (`TRACKING_STORE`) for online judges. Disable only the Postgres path with `MLFLOW_TRACKING_STORE_EXPORT_ENABLED=false` (online judges will not run).

**Trace export errors (HTTP 400):** MLflow rejects non-string `request_metadata` values. The kernel normalizes metadata via `normalizeStringRecord()` and flushes after each turn (`flushCompositeTraces()` in `traceAgentTurn`, artifact + OTLP). Verify with `MLFLOW_TRACKING_URI=http://localhost:5000/mlflow` and check both agent experiments in the MLflow UI.

Disable tracing without removing env defaults:

```bash
MLFLOW_TRACING_ENABLED=false
```

Diagnostic with TRACKING_STORE export:

```bash
MLFLOW_TRACKING_URI=http://mlflow:5000/mlflow MLFLOW_EXPERIMENT_ID=4 \
  npx tsx scripts/diagnose-mlflow-tracking-store.mjs
```

## Authentication

Agent HTTP endpoints use **A2A v0.3-style API key authentication** when `AGENT_API_KEY` is set in the clone’s `.env`.

- Each cloned agent gets a unique `AGENT_API_KEY` during `package load`.
- The agent card advertises the scheme in `securitySchemes` / `security` (OpenAPI 3.0 `apiKey` in header).
- Callers must send the key on every request except `GET /health` (missing/invalid key → HTTP `401`).
- [`SimulatorController`](../SimulatorController/) and [`a2a-registry`](../a2a-registry/) read keys from their `AGENT_API_KEYS` JSON map (auto-updated on `package load`).

Example request:

```bash
curl -H "X-Api-Key: $AGENT_API_KEY" http://127.0.0.1:3011/.well-known/agent-card.json
```

Interactive A2A client (`npm run a2a:chat`) reads `AGENT_API_KEY` from the clone `.env` or environment.

If `AGENT_API_KEY` is unset, the API server runs **without** inbound auth (development only; a warning is logged at startup).

See [`.env.example`](.env.example) for variable names.

## Minimal OpenAPI control API

Enable API mode with:

```bash
API_SERVER_ENABLED=true npx tsx src/index.ts
```

To run several agent clones on one host without port clashes, pass an explicit listener port (1–65535). This sets `API_SERVER_PORT` for that run and overrides `.env` for the same variable:

```bash
API_SERVER_ENABLED=true npx tsx src/index.ts --port 3012
```

Available routes (require `X-Api-Key` when `AGENT_API_KEY` is configured):

- `POST /v1/sessions`
- `POST /v1/sessions/{sessionId}/turns`
- `GET /health` (no authentication)
- `GET /v1/agent/info`
- `GET /openapi.json`
- `GET /.well-known/agent-card.json`
- `POST /v1` (A2A JSON-RPC)

## A2A registration workflow

When `A2A_ENABLED=true`, the kernel materializes an agent card and can register it against a registry API that matches `POST /api/agents/register` with `wellKnownURI`.

Example:

```bash
A2A_ENABLED=true \
A2A_REGISTRY_BASE_URL=https://start5g-1.cs.uit.no/a2a-registry \
A2A_AGENT_BASE_URL=http://localhost:3010 \
API_SERVER_ENABLED=true \
npx tsx src/index.ts
```

## Package wiring guide

1. Keep this project as your agent workspace implementation package.
2. Packages live outside baseline agent in `../SimulatorAgentPackages/<package-name>`.
3. Keep kernel generic; switch domain behavior by swapping package directory only.
4. Configure provider keys and model defaults in env (`LLM_PROVIDER`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).

## Package load command (from kernel)

Load a package archive and materialize an isolated runnable clone:

```bash
npx tsx src/index.ts package load /path/to/my-package.tgz
# or load directly from an unpacked package directory
npx tsx src/index.ts package load ../SimulatorAgentPackages/my-package
# skip Docker build/start (filesystem clone only)
npx tsx src/index.ts package load --no-container ../SimulatorAgentPackages/my-package
```

What it does:

- Extracts and validates the package into `../SimulatorAgentPackages/<package-name>`.
- Clones baseline agent into `../SimulatorAgentKernel-<package-name>` (or `-v2`, `-v3`, ... if needed).
- Copies package-provided tool sources from `<package>/tools/*.ts` into cloned `src/tools/`.
- Updates cloned `.env`:
  - `DOMAIN_PACKAGE_DIR=./`
  - `SKILL_FILE=./skills/SKILL.md`
  - `AGENT_API_KEY=<generated>` (unique per clone)
  - `AGENT_API_KEYS` merged into [`SimulatorController/.env`](../SimulatorController/.env) and [`a2a-registry/backend/.env`](../a2a-registry/backend/.env)
- Unless `--no-container` or `CONTAINER_LOAD=false`: writes `docker-compose.yml`, runs `docker compose up -d --build`, and waits for `GET /health` on the published host port.

Each clone includes a `Dockerfile` and, after load, a generated `docker-compose.yml` with `extra_hosts` for `host.docker.internal` so containers can reach host Pushgateway/Prometheus. Containers publish `API_SERVER_PORT` to the host so existing Caddy `host.docker.internal:<port>` routes keep working.

After this step, manage the cloned folder's container (or run on the host with `--no-container`).

Create an archive from a package folder:

```bash
npm run package:tgz -- ../SimulatorAgentPackages/5g4data-intent-generation
# optional output path
npm run package:tgz -- ../SimulatorAgentPackages/5g4data-intent-generating-agent dist/packages/5g4data.tgz
```

## Package contract (extended)

Expected package layout (required + optional assets):

- required core:
  - `manifest.json`, `workflow.dsl.json`, `rules/`, `validators/`, `tools/`, `prompts/`, `prompt_modules/`
  - `skills/SKILL.md`
  - tool source files in `tools/*.ts` (copied to cloned agent `src/tools/` on load)
  - optional postprocessor declaration file referenced by `manifest.json` (`postprocessors`)
  - optional postprocessor modules (for example `tools/postprocess/*.ts`) executed only when declared
  - recommended ID flow: model emits stable placeholders (for example `data5g:CO__ID_CONDITION_LATENCY_1__`), package postprocessor rewrites to strict UUIDv4 local-name suffixes
- optional/extended:
  - `compatibility.json`
  - `dependencies/`
  - `schemas/`
  - `validation/`
  - `examples/`
  - `tests/`
  - `checksums.txt`
  - `mappings/`

