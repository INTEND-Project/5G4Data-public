# OpenClawAgent

TypeScript-first OpenClaw implementation of HermesAgentReal intent-authoring behavior for 5G4Data.

## What is implemented
- TS-native turn orchestrator (`src/core/turnOrchestrator.ts`)
- TS-native domain tools:
  - workload catalogue (`src/tools/catalogueTool.ts`)
  - GraphDB lookup (`src/tools/graphdbTool.ts`)
  - ontology/example context (`src/tools/ontologyTool.ts`)
  - locality/geocode utilities (`src/tools/localityTool.ts`)
- Output policy validation + repair loop (`src/core/outputPolicyValidator.ts`, `src/core/repairEngine.ts`)
- SHACL validation loop scaffolding (`src/core/shaclValidatorTool.ts`)
- OpenClaw integration adapter stub (`src/adapters/openclaw.ts`)

## Install
```bash
cd OpenClawAgent
npm install
```

## Run a local dry turn
```bash
npx tsx src/index.ts "I need at least 300 Mbit/s and under 80ms for drone video near Tromso."
```

## Environment variables
- `LLM_PROVIDER`: `openai` or `anthropic`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`
- `OPENCLAW_MODEL`
- `WORKLOAD_CATALOG_BASE_URL`
- `GRAPHDB_ENDPOINT`, `GRAPHDB_NAMED_GRAPH`, `GRAPHDB_QUERY_LIMIT`, `GRAPHDB_CONTEXT_LIMIT`
- `DEFAULT_INTENT_HANDLER`, `DEFAULT_INTENT_OWNER`, `AUTO_GENERATE_DESCRIPTION`
- `SKILL_FILE`, `SYSTEM_PROMPT_FILE`
- `SHACL_SHAPES_FILE`, `SHACL_MAX_RETRIES`

## OpenClaw wiring guide
1. Keep this project as your agent workspace implementation package.
2. In OpenClaw runtime, replace `createOpenClawModelInvoker()` implementation in `src/adapters/openclaw.ts` with your real OpenClaw model/tool call path.
3. Point OpenClaw agent config to this package and the included skill:
   - `OpenClawAgent/skills/tmf-intent-authoring/SKILL.md`
4. Configure equivalent defaults in OpenClaw JSON (`~/.openclaw/openclaw.json`) for model/provider and secure tool access.

## Known differences vs HermesAgentReal
- SHACL execution currently performs Turtle parse + shape-file existence gate and is structured for plugging in full SHACL engine in Node runtime.
- Semantic chart-selection via LLM is left as OpenClaw model behavior; deterministic explicit-name selection is included.
- `src/adapters/openclaw.ts` is a stub and must be connected to your OpenClaw gateway APIs.
