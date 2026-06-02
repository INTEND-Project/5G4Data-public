# 5g4data-intent-observations

Domain package for generating TM Forum formatted observation report payloads from an existing intent.

## Scope

- Package-only implementation under `SimulatorAgentPackages/5g4data-intent-observations`.
- Requires runtime capability wiring in `SimulatorAgentKernel` so `intent_id` can be fetched from GraphDB and injected into runtime context.

## Inputs

- Required: `intent_id`
- Optional natural language instructions for runtime behavior
- Optional structured JSON override:
  - `metricValueSpans`
  - `eventRules`
  - `timeWindows`

## LLM-coded synthetic observations (multi-metric)

Structured prompts invoke an OpenAI-compatible model to synthesize JavaScript snippets that sample values per metric. Each metric runs in its **own spawned process** (`npx tsx tools/syntheticMetricWorker.ts`). Detection requires `intent_id=`, `mode=streaming|historic`, `frequency=…`, and one or more `metric=` clauses whose value matches `{targetProperty}_CO{32 hex}`.

- **`mode=streaming`**: emits on wall-clock intervals (`frequency=60s` etc.).
- **`mode=historic`**: requires `start` / `stop` as `dd.mm.yyyy hh:mm:ss` or **`dd.mm.yyyy hh.mm.ss`** (both interpreted as **UTC**) and emits as fast as possible across that simulated timeline.
- **Env**: `SYNTH_OBS_OPENAI_API_KEY` (or `OPENAI_API_KEY`), `SYNTH_OBS_OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `SYNTH_OBS_MODEL` (default `gpt-4o-mini`). Optional historic cap `SYNTH_OBS_HISTORIC_MAX_POINTS` (default 250000). Historic Prometheus: `SYNTH_OBS_PROM_FLUSH_CHUNK` (default 10000; `0` = single flush at end). Set `OBS_LOG_N=0` on the agent CLI to skip per-tick NDJSON logging for maximum throughput.

These prompts are handled in the agent pre-turn hook (REPL **and** HTTP `/v1/sessions/…/turns`) or explicitly as `observe synthetic …`.

## Behavior

1. Resolve the intent Turtle by `intent_id`.
2. Identify reportable metrics through `ObservationReportingExpectation` and linked `Condition` statements.
3. Resolve frequency from trigger delay.
4. Apply runtime overrides (time window > event > baseline).
5. Generate TM Forum observation report Turtle payloads.
6. Retain the last N observation payloads per metric in `logs/observations-<metric>.ndjson` (default N=100; `--obsLogN` on the agent CLI or `OBS_LOG_N`; `OBSERVATION_LOG_PATH` to override the log directory).
7. Store the latest synthetic sampler program per metric in `logs/observation-program-<metric>.js` (LLM-generated function body; overwritten on each new synthetic run for that metric).
8. Persist observation datapoints per `icm:reportDestinations` on the intent (`data5g:graphdb` → Turtle in GraphDB; `data5g:prometheus` → Pushgateway per sample for **streaming**, or **chunked Prometheus remote write** for historic runs). Historic `storage prometheus` uses a fast path (no per-tick Turtle/GraphDB/NDJSON) and flushes every `SYNTH_OBS_PROM_FLUSH_CHUNK` samples so the Controller can mark intents green as data lands in Prometheus. Always register retrieval metadata in GraphDB (`storeGraphdbMetadata` or `storePrometheusMetadata`). Session override via A2A `openclaw.observationStorage` or Controller `request observation-report … storage`. Print payloads when `--noGraphDB` skips GraphDB inserts only.

## Clone / Prometheus env

Applied automatically on `package load` via `tools/onPackageLoad.ts` (see `mappings/env.defaults.json`):

| Variable | Purpose | Clone value (start5g-1) |
|----------|---------|-------------------------|
| `PROMETHEUS_URL` | GraphDB `hasQuery` metadata base (read by IntentReportQueryProxy on host) | `http://127.0.0.1:9090/prometheus` |
| `PROMETHEUS_REMOTE_WRITE_URL` | Historic batch remote-write from container | `http://host.docker.internal:9090/prometheus/api/v1/write` |
| `PUSHGATEWAY_URL` | Streaming Pushgateway from container | `http://host.docker.internal:9091` |

Also merges package `package.json` dependencies into the clone and refreshes the clone `package-lock.json` via `npm install --package-lock-only` so Docker `npm ci` succeeds. Clone `docker-compose.yml` (from the kernel) includes `host.docker.internal:host-gateway` in `extra_hosts`. Rebuild the container after `package load`.

## `--port` (clone runtime)

When running the **cloned** agent (`SimulatorAgentKernel-5g4data-intent-observations`) with the OpenAPI server enabled, you can set the HTTP listener port without editing `.env`:

```bash
API_SERVER_ENABLED=true npx tsx src/index.ts --port 3013
```

Equivalent to setting `API_SERVER_PORT` for that process; use a unique port per clone on the same host. Does not change `A2A_AGENT_BASE_URL`—keep that aligned with your reverse proxy or registry.

## `--obsLogN`

On the OpenClaw agent CLI (observation clone runtime):

```bash
npx tsx src/index.ts --obsLogN 250
```

- Default: **100** (keeps the last 100 NDJSON lines per metric in `logs/observations-<metric>.ndjson`).
- Sets `OBS_LOG_N` for the process and synthetic worker children.
- `--obsLogN 0` disables observation file logging.

## `--noGraphDB`

When `--noGraphDB` is enabled in the loaded clone runtime:
- GraphDB writes are skipped.
- Generated report payloads are printed in the interactive window.
- Output includes marker: `GraphDB write skipped (--noGraphDB)`.

## Example observation payload

```ttl
@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix data5g: <http://5g4data.eu/5g4data#> .

data5g:OB5ad2a6f39d324f24a4b35fd2a73c0f11 a met:Observation ;
    met:observedMetric data5g:detection-latency_CO282f7522f48b40c797826daa0d964ccc ;
    met:observedValue [ rdf:value 1234.5 ; quan:unit "ms" ] ;
    met:obtainedAt "2026-04-30T08:30:00Z"^^xsd:dateTime .
```
