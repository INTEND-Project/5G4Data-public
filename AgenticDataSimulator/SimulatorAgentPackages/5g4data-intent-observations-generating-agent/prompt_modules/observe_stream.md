Continuous observation streaming commands (REPL pre-turn hook):

- `observe start intent_id=<intent_id>`
  - Fetch intent Turtle from GraphDB.
  - Parse reportable streams (ObservationReportingExpectation x Condition metric).
  - Start one scheduler per stream using stream-specific frequency.
  - Emit first tick immediately, then continue at interval.
- `observe status`
  - Show active stream count and per-stream metric/frequency summary.
- `observe stop`
  - Stop all stream timers for this REPL session.
- `observe override metric=<metric_name> min=<number> max=<number>`
  - Store runtime span override for the metric in current session.
  - Override affects subsequent ticks.

## Synthetic LLM workers

When a user prompt matches the structured synthetic DSL **or** the REPL invokes `observe synthetic …`, this package routes through `syntheticRunOrchestrator`:

- Fetch intent Turtle, resolve units per `{targetProperty}_{conditionId}` compound.
- Perform OpenAI-compatible `chat/completions` call per metric (`SYNTH_OBS_*` env; see README).
- Compose codegen system prompt from `gauge_codegen`, `stress_dip_codegen`, or `cumulative_codegen` modules (by instruction classifiers) plus validation before spawn.
- Write snippets under `logs/synthetic-runs/<sessionId>/…` and spawn `npx tsx tools/syntheticMetricWorker.ts <config.json>` (one PID per metric; parallel emission).
- Copy each validated sampler program to `logs/observation-program-<metric>.js` (latest codegen per metric; same log directory as observation NDJSON when `OBSERVATION_LOG_PATH` is set).
- `mode=streaming` uses sequential wall-clock pacing; `mode=historic` replays deterministic sim-time timestamps from `start`→`stop` as fast as possible (subject to `SYNTH_OBS_HISTORIC_MAX_POINTS`).

REPL shortcuts:

- `observe synthetic …` — same globals/metric prose as autonomous prompts.
- `observe synthetic stop` — terminate synthetic workers without touching classical stream timers unless `observe stop` is used.
- `observe status` merges classical stream summaries with synthetic PID listing.
- `observe stop` stops **both**.

Observation log (always on):
- Each generated observation is written to `logs/observations-<metric>.ndjson` (one file per metric; override log directory with `OBSERVATION_LOG_PATH`).
- The file keeps at most the **last N** entries (default **N=100**). Set N with agent CLI `--obsLogN <N>` (exports `OBS_LOG_N` for synthetic worker children) or env `OBS_LOG_N`. Use `--obsLogN 0` to disable file logging.
- One NDJSON line per observation: payload fields, full Turtle, and whether GraphDB accepted the write.

Debug behavior:
- If `--debug` is active (in addition to the observation log):
  - Append stream metadata entries to `logs/observations-stream.ndjson`.
  - Append full Turtle payloads to per-metric files:
    - `logs/observations-by-metric/<metric_name>.ttl`

GraphDB behavior:
- If `--noGraphDB` is active, skip GraphDB insert and print payloads.
- Otherwise insert each generated Turtle payload.
