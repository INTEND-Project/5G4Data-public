# OpenClawAgent

TypeScript-first OpenClaw kernel for package-based intent agents.

`OpenClawAgent` is the generic loader/kernel.  
The actual runnable agents are the cloned instances created as `../OpenClawAgent-<package-name>` (or versioned variants such as `-v2`).

Related guide:
- Package authoring and structure: `../OpenClawPackages/README.md`

## What is implemented
- Domain package kernel with declarative package loading (`src/core/packageLoader.ts`, `src/core/workflowEngine.ts`)
- Package-driven orchestration (`src/core/turnOrchestrator.ts`)
- Package-provided domain tools loaded at runtime from the active package
- Output policy validation + repair loop (`src/core/outputPolicyValidator.ts`, `src/core/repairEngine.ts`)
- SHACL validation loop scaffolding (`src/core/shaclValidatorTool.ts`)
- OpenAI/Anthropic integration adapter (`src/adapters/openclaw.ts`)

## Install
```bash
cd OpenClawAgent
npm install
```

## Agent lifecycle (important)

- `OpenClawAgent`: baseline kernel used to load packages.
- `OpenClawPackages/<package-name>`: domain behavior package.
- `OpenClawAgent-<package-name>`: resulting concrete agent instance you actually run.

In normal usage, you create/update agents from this kernel, then run the cloned agent instance.

## Create `OpenClawAgent-<package-name>` instances
```bash
# 1) install deps in kernel
cd OpenClawAgent
npm install

# 2) create/update an agent instance from a package
npx tsx src/index.ts package load ../OpenClawPackages/5g4data-intent-generation

# 3) enter the created agent clone
cd ../OpenClawAgent-5g4data-intent-generation

# 4) run the actual agent instance
npx tsx src/index.ts --debug
```

You can also load from archive:

```bash
npx tsx src/index.ts package load /path/to/my-package.tgz
```

## Run the resulting agent

From a cloned agent directory (`OpenClawAgent-<package-name>`):

```bash
# one-shot
npx tsx src/index.ts "I need at least 300 Mbit/s and under 80ms for drone video near Tromso."

# interactive debug mode
npx tsx src/index.ts --debug
```

## Debug mode (in cloned agent)
Enable debug logging for full per-turn diagnostics (including generated Turtle candidates, validation issues, and SHACL reports):

```bash
# Interactive with debug log at default path
npx tsx src/index.ts --debug

# One-shot with debug
npx tsx src/index.ts --debug "Generate deployment intent near Tromso"

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
- `DOMAIN_PACKAGE_DIR` (defaults to `../OpenClawPackages/5g4data-intent-generation`)
- `LLM_USAGE_LOG_PATH` (optional JSONL file for per-intent token/cost summaries)
- `WORKLOAD_CATALOG_BASE_URL`
- `GRAPHDB_ENDPOINT`, `GRAPHDB_NAMED_GRAPH`, `GRAPHDB_QUERY_LIMIT`, `GRAPHDB_CONTEXT_LIMIT`
- `DEFAULT_INTENT_HANDLER`, `DEFAULT_INTENT_OWNER`, `AUTO_GENERATE_DESCRIPTION`
- `SKILL_FILE`, `SYSTEM_PROMPT_FILE` (optional compatibility layer; package prompts are primary)
- `SHACL_SHAPES_FILE`, `SHACL_MAX_RETRIES`

## Package wiring guide
1. Keep this project as your agent workspace implementation package.
2. Packages live outside baseline agent in `../OpenClawPackages/<package-name>`.
3. Keep kernel generic; switch domain behavior by swapping package directory only.
4. Configure provider keys and model defaults in env (`LLM_PROVIDER`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).

## Package load command (from kernel)

Load a package archive and materialize an isolated runnable clone:

```bash
npx tsx src/index.ts package load /path/to/my-package.tgz
# or load directly from an unpacked package directory
npx tsx src/index.ts package load ../OpenClawPackages/my-package
```

What it does:
- Extracts and validates the package into `../OpenClawPackages/<package-name>`.
- Clones baseline agent into `../OpenClawAgent-<package-name>` (or `-v2`, `-v3`, ... if needed).
- Copies package-provided tool sources from `<package>/tools/*.ts` into cloned `src/tools/`.
- Updates cloned `.env`:
  - `DOMAIN_PACKAGE_DIR=../OpenClawPackages/<package-name>`
  - `SKILL_FILE=../OpenClawPackages/<package-name>/skills/SKILL.md`

After this step, run the cloned folder, not the kernel folder.

Create an archive from a package folder:

```bash
npm run package:tgz -- ../OpenClawPackages/5g4data-intent-generation
# optional output path
npm run package:tgz -- ../OpenClawPackages/5g4data-intent-generation dist/packages/5g4data.tgz
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

