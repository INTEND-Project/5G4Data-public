# 5g4data-intent-observation-schema-synth-agent

Sibling observation agent for Controller Studio. Maps NL observation instructions to a **ConstraintDocument**, then renders deterministic time series (historic or streaming) with production Prometheus/GraphDB labeling.

- Package: `SimulatorAgentPackages/5g4data-intent-observation-schema-synth-agent`
- Agent card name: `5g4data-intent-observation-schema-synth-agent`
- Port: **3015**
- Discovery: skill tag `discovery-task:observation-agent` (same domain `telenor.5g4data` as the LLM-codegen observation agent on 3012)

## Synthesis path

1. Parse structured prompt globals (`intent_id`, `mode`, `frequency`, `start`/`stop`, `metric=…`).
2. NL → `ConstraintDocument` via `tools/schemaSynth/nlToSchema.ts` (LLM when `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `SYNTH_OBS_OPENAI_API_KEY` is set; otherwise heuristic).
3. Spawn `tools/schemaSynthMetricWorker.ts` per metric.
4. Persist with `job=intent_reports` labels and observation progress/errors HTTP APIs.

## Controller Studio usage

```text
discover observation-agent by domain telenor.5g4data as obs
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, …" as sess
```

When both observation agents are registered, star **schema-synth** in the Agents panel (preferred agent) so discover picks this card.

## Load / start

```bash
# From AgenticDataSimulator
./agent-control reload   # includes this package on 3015 once listed in CORE_AGENTS

# Or manually
cd SimulatorAgentKernel
npx tsx src/index.ts package load ../SimulatorAgentPackages/5g4data-intent-observation-schema-synth-agent
```

## Ops checklist

1. Caddy: proxy `/5g4data-intent-observation-schema-synth-agent/*` → host `:3015` (mirror the 3012 observation agent path).
2. Add the card name to `SimulatorController/.env` `AGENT_API_KEYS`.
3. Optional: set `OBSERVATION_AGENT_CONTROL_BASE_URL=http://127.0.0.1:3015/v1` when preferring this agent and public Caddy does not route control GETs.
4. Restart Controller after key sync.

## Env

See `mappings/env.defaults.json`. Defaults prefer **Anthropic** for conversational turns and NL→schema mapping (`LLM_PROVIDER=anthropic`, `SCHEMA_SYNTH_PROVIDER=anthropic`, `SCHEMA_SYNTH_MODEL=claude-sonnet-4-5`) to match `experiments/observation-schema-synth`. Package load merges these into the clone `.env`.

| Variable | Role |
|----------|------|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `SYNTH_OBS_OPENAI_API_KEY` | NL→schema LLM |
| `LLM_PROVIDER` / `ANTHROPIC_MODEL` | Conversational A2A turns + Studio “Reset to agent defaults” |
| `SCHEMA_SYNTH_MODEL` / `SCHEMA_SYNTH_PROVIDER` | NL→ConstraintDocument mapping (same system prompt as the experiment CLI) |
| `SYNTH_OBS_HISTORIC_MAX_POINTS` | Historic point cap (default 250000) |
| `SYNTH_OBS_PROM_FLUSH_CHUNK` | Remote-write chunk size |

## Tests

```bash
cd SimulatorAgentPackages/5g4data-intent-observation-schema-synth-agent
npm install
npm test
```
