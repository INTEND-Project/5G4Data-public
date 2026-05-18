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
- Write snippets under `logs/synthetic-runs/<sessionId>/…` and spawn `npx tsx tools/syntheticMetricWorker.ts <config.json>` (one PID per metric; parallel emission).
- `mode=streaming` uses sequential wall-clock pacing; `mode=historic` replays deterministic sim-time timestamps from `start`→`stop` as fast as possible (subject to `SYNTH_OBS_HISTORIC_MAX_POINTS`).

REPL shortcuts:

- `observe synthetic …` — same globals/metric prose as autonomous prompts.
- `observe synthetic stop` — terminate synthetic workers without touching classical stream timers unless `observe stop` is used.
- `observe status` merges classical stream summaries with synthetic PID listing.
- `observe stop` stops **both**.

Debug behavior:
- If `--debug` is active:
  - Append stream metadata entries to `logs/observations-stream.ndjson`.
  - Append full Turtle payloads to per-metric files:
    - `logs/observations-by-metric/<metric_name>.ttl`

GraphDB behavior:
- If `--noGraphDB` is active, skip GraphDB insert and print payloads.
- Otherwise insert each generated Turtle payload.
