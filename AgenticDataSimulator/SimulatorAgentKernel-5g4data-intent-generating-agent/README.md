# SimulatorAgentKernel

TypeScript-first OpenClaw kernel for package-based intent agents.

`SimulatorAgentKernel` is the generic loader/kernel.  
The actual runnable agents are the cloned instances created as `../SimulatorAgentKernel-<package-name>` (or versioned variants such as `-v2`).

Related guide:

- Package authoring and structure: `../SimulatorAgentPackages/README.md`

## What is implemented

- Domain package kernel with declarative package loading (`src/core/packageLoader.ts`, `src/core/workflowEngine.ts`)
- Package-driven orchestration (`src/core/turnOrchestrator.ts`)
- Package-provided domain tools loaded at runtime from the active package
- Output policy validation + repair loop (`src/core/outputPolicyValidator.ts`, `src/core/repairEngine.ts`)
- SHACL validation loop scaffolding (`src/core/shaclValidatorTool.ts`)
- OpenAI/Anthropic integration adapter (`src/adapters/openclaw.ts`)

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

# 2) create/update an agent instance from a package
npx tsx src/index.ts package load ../SimulatorAgentPackages/5g4data-intent-generation

# 3) enter the created agent clone
cd ../SimulatorAgentKernel-5g4data-intent-generation

# 4) run the actual agent instance
npx tsx src/index.ts --debug
```

You can also load from archive:

```bash
npx tsx src/index.ts package load /path/to/my-package.tgz
```

## Run the resulting agent

From a cloned agent directory (`SimulatorAgentKernel-<package-name>`):

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
- `DOMAIN_PACKAGE_DIR` (defaults to `../SimulatorAgentPackages/5g4data-intent-generation`)
- `LLM_USAGE_LOG_PATH` (optional JSONL file for per-intent token/cost summaries)
- `WORKLOAD_CATALOG_BASE_URL`
- `GRAPHDB_ENDPOINT`, `GRAPHDB_NAMED_GRAPH`, `GRAPHDB_QUERY_LIMIT`, `GRAPHDB_CONTEXT_LIMIT`
- `DEFAULT_INTENT_HANDLER`, `DEFAULT_INTENT_OWNER`, `AUTO_GENERATE_DESCRIPTION`
- `SKILL_FILE`, `SYSTEM_PROMPT_FILE` (defaults to `./SYSTEM_PROMPT.md` in the kernel; optional compatibility layer — package prompts are primary)
- `SHACL_SHAPES_FILE`, `SHACL_MAX_RETRIES`
- `API_SERVER_ENABLED`, `API_SERVER_HOST`, `API_SERVER_PORT` (overridden for this process by CLI `--port <n>` when given)
- `A2A_ENABLED`, `A2A_REGISTRY_BASE_URL`, `A2A_AGENT_BASE_URL`, `A2A_AGENT_CARD_PATH`, `A2A_AUTO_REGISTER_ON_STARTUP`

## Minimal OpenAPI control API

Enable API mode with:

```bash
API_SERVER_ENABLED=true npx tsx src/index.ts
```

To run several agent clones on one host without port clashes, pass an explicit listener port (1–65535). This sets `API_SERVER_PORT` for that run and overrides `.env` for the same variable:

```bash
API_SERVER_ENABLED=true npx tsx src/index.ts --port 3012
```

Available routes:

- `POST /v1/sessions`
- `POST /v1/sessions/{sessionId}/turns`
- `GET /health`
- `GET /v1/agent/info`
- `GET /openapi.json`
- `GET /.well-known/agent-card.json`

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
```

What it does:

- Extracts and validates the package into `../SimulatorAgentPackages/<package-name>`.
- Clones baseline agent into `../SimulatorAgentKernel-<package-name>` (or `-v2`, `-v3`, ... if needed).
- Copies package-provided tool sources from `<package>/tools/*.ts` into cloned `src/tools/`.
- Updates cloned `.env`:
  - `DOMAIN_PACKAGE_DIR=../SimulatorAgentPackages/<package-name>`
  - `SKILL_FILE=../SimulatorAgentPackages/<package-name>/skills/SKILL.md`
  - `AGENT_API_KEY=<generated>` (unique per clone)
  - `AGENT_API_KEYS` merged into [`SimulatorController/.env`](../SimulatorController/.env) and [`a2a-registry/backend/.env`](../a2a-registry/backend/.env)

After this step, run the cloned folder, not the kernel folder.

Create an archive from a package folder:

```bash
npm run package:tgz -- ../SimulatorAgentPackages/5g4data-intent-generation
# optional output path
npm run package:tgz -- ../SimulatorAgentPackages/5g4data-intent-generation dist/packages/5g4data.tgz
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

