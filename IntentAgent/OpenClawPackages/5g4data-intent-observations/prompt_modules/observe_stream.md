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

Debug behavior:
- If `--debug` is active:
  - Append stream metadata entries to `logs/observations-stream.ndjson`.
  - Append full Turtle payloads to per-metric files:
    - `logs/observations-by-metric/<metric_name>.ttl`

GraphDB behavior:
- If `--noGraphDB` is active, skip GraphDB insert and print payloads.
- Otherwise insert each generated Turtle payload.
