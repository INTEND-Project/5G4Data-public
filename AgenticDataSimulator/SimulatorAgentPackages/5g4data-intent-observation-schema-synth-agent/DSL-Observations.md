# DSL observation-report statements (schema-synth agent)

Controller Studio scripts (`*.dsl`) drive this agent with `request observation-report …`.
Instructions are mapped to a **ConstraintDocument**, then rendered deterministically (typescript code)
(historic or streaming).

Agent card: `5g4data-intent-observation-schema-synth-agent` (port **3015**).
Discover with skill tag `discovery-task:observation-agent` / domain `telenor.5g4data`. Star (mark as favorite) **schema-synth** in the Controller Studio Agents panel when more than one observation agent is registered to make sure that this agent is used.

---

## Statement shape

```text
request observation-report using <obsAlias> for <intentRef>
  [storage graphdb|prometheus]
  instructions "<structured globals + per-metric NL>"
  as <sessionAlias>
```


| Clause              | Required    | Notes                                                                                                                                       |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `using <obsAlias>`  | yes         | From `discover observation-agent by domain … as <obsAlias>`                                                                                 |
| `for <intentRef>`   | yes         | Create-intent alias (`myIntent`) **or** canonical id (`I` + 32 hex). Do **not** put `intent_id=…` in instructions—the Controller injects it |
| `storage graphdb    | prometheus` | no                                                                                                                                          |
| `instructions "…"`  | yes         | Structured backtick globals + natural-language metric prose                                                                                 |
| `as <sessionAlias>` | yes         | Dialog / run session handle                                                                                                                 |


One statement per line. `#` starts a comment. Blank lines are ignored.

### Minimal script context

```text
discover intent-agent by domain telenor.5g4data as intentGen
create intent using intentGen storage prometheus prompt "…" as myIntent
extract metric-catalog for myIntent as myMetrics

discover observation-agent by domain telenor.5g4data as obs
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target`, default range is between 700-1500." as sess
```

When a metric catalog exists, stems such as `p99-token-target` are rewritten to compound names (`p99-token-target_CO…`) before the seed is sent. You may also write the full compound yourself.

---



## Structured globals (inside `instructions`)

Prefer backtick-wrapped `key=value` tokens (Controller and agent both parse these):


| Global               | Required      | Values                                                                                                                               |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `mode=…`             | yes           | `historic` or `streaming`                                                                                                            |
| `frequency=…`        | yes           | `60s`, `5m`, `1h`, or bare seconds (`60`)                                                                                            |
| `start=…` / `stop=…` | historic only | `dd.mm.yyyy hh:mm:ss` or `dd.mm.yyyy hh.mm.ss` (**UTC**). `stop` must be after `start`                                               |
| `timezone=…`         | no            | Optional IANA / offset hint for clock windows                                                                                        |
| `metric=…`           | ≥1            | Stem or `{property}_{conditionId}` compound. Repeat for multi-metric **in one instructions string**, or use one statement per metric |


Historic tick count must stay under `SYNTH_OBS_HISTORIC_MAX_POINTS` (default **250 000**). Shorten the window or raise `frequency` if Studio validation complains.

**Script rule:** all `request observation-report` lines in one script must share the same `mode` (do not mix historic and streaming).

### Historic vs streaming skeletons

```text
# Historic (sim-time window, fast replay / remote-write chunks)
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=service-latency`, default range is between 40-80." as historicSess

# Streaming (wall-clock ticks; no start/stop)
request observation-report using obs for myIntent storage prometheus instructions "`mode=streaming`, `frequency=60s`. For `metric=service-latency`, keep values in the 40-80 range with low noise." as streamSess

# GraphDB storage override (or omit storage to follow the intent)
request observation-report using obs for myIntent storage graphdb instructions "`mode=streaming`, `frequency=120s`. For `metric=energy-consumption`, gauge between 100-300." as graphdbSess

# Canonical intent id (no create-intent alias needed)
request observation-report using obs for I6be57670fcad46fba1f648ad28b9cdb5 instructions "`mode=streaming`, `frequency=60s`. For `metric=energy-consumption`, gauge." as byIdSess
```

---



## Supported instruction variations

Per-metric prose (after each `metric=…`) is mapped to a ConstraintDocument
(LLM when API keys are set; otherwise heuristic). Prefer constraint language over
`ctx.*` / JS loops—those style phrases are reinterpreted as bands/counters, not executed.

### 1. Baseline value range (aka. band)

Numeric ranges: `between A-B`, `range … A-B`, `keep values in the A-B range`, `A-B ms|Mbps|percent`.

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=service-latency`, default range is between 40-80. Between 06:00 and 18:00 keep values in the 20-45 range with low noise and mild daily variation. No stress episodes." as daytimeBandSession
```



### 2. Recurring clock windows + noise / daily variation

Hours `HH:MM`–`HH:MM` (or `between HH:MM and HH:MM`) with optional `low|high noise`, `daily variation`, day vs night / off-hours bands.

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-latency`, during daytime 06:00-18:00 keep 20-50 ms; at night keep 5-15 ms; low noise; no incidents." as netLatencyNightSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-jitter`, most of the day keep 1-3 ms with low noise; between 14:00-16:00 keep 5-20 ms with higher noise." as jitterUnstableSession
```



### 3. Episodes: dips / spikes / bursts (stress, congestion, batch, …)

Keywords: `stress`, `congestion`, `dip`, `spike`, `burst`, `batch`, `scarcity`, `compaction`, `maintenance`.
Include episode band, duration (`3-10 minutes`), and count (`at least two … per …`).

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target`, default range is between 700-1500, between 06:00 and 18:00 keep values in the 500-1000 range with daily variation and low noise. During stress periods between 08:00-09:00 and 16:00-17:00 create dips down to between 200-300 for periods lasting between 3-10 minutes, at least two dips per stress period" as p99StressSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=energy-consumption`, default range is between 100-300, between 06:00 and 18:00 gradually increase values to be in the 500-1000 range with daily variation and low noise. During stress periods between 08:00-09:00 and 16:00-17:00 create spikes up to between 600-800 for periods lasting between 3-10 minutes, at least two spikes per stress period" as energyDaytimeStressSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-latency`, baseline between 15-40 ms. During congestion windows 09:00-10:00 and 17:00-18:00 create spikes up to 80-150 ms lasting 2-8 minutes, at least two spikes per congestion window." as netLatencyCongestionSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=packet-loss`, default near 0-0.1 percent. During 12:00-14:00 create at least one burst to 1-3 percent lasting 1-5 minutes." as packetLossBurstSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=cpu-utilization`, baseline 15-35 percent. During batch windows 02:00-04:00 and 22:00-23:00 spike to 75-95 percent for contiguous runs lasting 20-40 minutes, at least one spike per batch window." as cpuBatchSession
```



### 4. Absolute UTC incident window

ISO-8601 interval override (forced band for that wall-clock span):

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-latency`, default range is between 15-40 ms. Between 2026-05-21T10:00:00Z and 2026-05-21T10:30:00Z force latency into the 80-120 ms band for an incident window." as incidentWindowSession
```



### 5. Cumulative / monotonic counter

Phrases: `cumulative`, `monotonic`, `running total`, `counter`, `start at N`, per-step increment band.
Prefer describing start + increment range; avoid relying on executable `ctx.*` loops.

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=360s`. For `metric=power-consumption`, monotonically increasing cumulative counter. Start at 100. Each tick add 324-396 joules. Values must never decrease." as powerCounterSession
```



### 6. Process models (level / seasonality / AR(1) / OU / shocks)

Keywords: `AR(1)`, `seasonal`, `Fourier`, `diurnal`, `mean-reverting`, `Ornstein-Uhlenbeck`, `OU`, `white noise`, `heavy-tailed`, `shocks`, `mean around`, `amplitude`, `clamp`.

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-latency`, mean around 25 ms with a smooth 24-hour seasonal swing of about plus or minus 10 ms. Residuals follow an AR(1)-like process with strong persistence and moderate sigma. Clamp all values to 5-80 ms." as latencyAr1Session

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=request-rate`, diurnal Fourier-style seasonality peaking mid-afternoon around a mean near 900 req/s with amplitude about 400. Additive light white noise most of the time. About 3-6 heavy-tailed positive shocks per day that briefly spike the rate then return. Keep values clamped between 50 and 2500." as requestRateShocksSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-throughput`, mean-reverting Ornstein-Uhlenbeck style process around 500 Mbps (mean-reverting AR(1) toward the target). Higher volatility during 08:00-09:00. Stay within 100-900 Mbps." as throughputOuSession
```



### 7. Multi-metric (one line or several)

**Several statements** (one metric each)—recommended in Studio; same `mode` / window:

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-latency`, keep values between 15-40 ms daytime 06:00-18:00 and 10-25 ms otherwise with low noise." as multiMetricLatencySession
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-throughput`, daytime 06:00-18:00 keep 600-900 Mbps and off-hours 100-300 Mbps with low noise." as multiMetricThroughputSession
```

**One instructions string** with repeated `metric=…` slices is also accepted by the agent parser.

### 8. Workload / QoS scenario patterns

```text
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=cpu-utilization`, night 5-20 percent; business hours 08:00-17:00 keep 40-70 percent; lunch 12:00-13:00 dip to 25-40 percent." as cpuBusinessSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=memory-utilization`, start each day near 45-55 percent and climb slowly toward 75-85 percent through the day, then drop back near 45-55 percent after midnight. This is a gauge, not a cumulative counter. Low noise." as memoryLeakSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=request-rate`, night 50-150 req/s; daytime 06:00-18:00 keep 800-1500; peak windows 10:00-11:00 and 15:00-16:00 reach 1500-2000." as requestRateDiurnalSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=queue-depth`, normally 0-20. During incident 11:00-11:45 climb into 200-400, then clear linearly so values are under 20 by 12:30." as queueBacklogSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=pod-restarts`, mostly 0. During maintenance 03:00-05:00 place 1-3 brief restart spikes where the value is 1 for one or a few samples." as podRestartSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=gpu-utilization`, daytime 06:00-18:00 keep 30-60 percent with low noise; during stress demo 13:00-14:00 push 85-98 percent in two bursts lasting 5-10 minutes each." as gpuInferenceSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=disk-io-wait`, default 0-5 percent. During compaction window 01:00-02:00 create a saturation episode at 40-70 percent lasting 10-25 minutes, at least one episode." as diskIoWaitSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-latency`, default 15-40 ms; during edge scarcity 18:00-20:00 keep 60-120 ms." as edgeScarcityLatencySession
request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=cpu-utilization`, default 20-40 percent; during scarcity 18:00-20:00 keep 70-90 percent." as edgeScarcityCpuSession

request observation-report using obs for myIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=network-throughput`, off-hours 100-300 Mbps; daytime 06:00-18:00 keep 800-1000 Mbps near capacity; during 08:30-09:30 create brief dips to 400-600 Mbps lasting 3-8 minutes, at least one dip." as throughputCapSession
```

---



## ConstraintDocument mapping summary


| NL idea                           | Schema fields                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Gauge bands                       | `samplingKind: gauge`, `defaultBand`, `recurringWindows`                      |
| Stress dips/spikes                | `episodes[]` (`type`, `windows`, `band`, `durationMinutes`, `countPerWindow`) |
| Absolute incident                 | `absoluteOverrides[]`                                                         |
| Counter                           | `samplingKind: counter`, `counter.startAt`, `counter.increment`               |
| AR(1) / OU / seasonality / shocks | `level`, `seasonality`, `residual`, `shocks`                                  |
| Noise                             | `noise`: `none`                                                               |


Always keep values bounded (`defaultBand` or `level.band` / clamp phrasing).

---



## Common mistakes


| Mistake                                     | Fix                                                  |
| ------------------------------------------- | ---------------------------------------------------- |
| Missing `mode=` / `frequency=` / `metric=`  | Structured synthetic run will not start              |
| Historic without `start=` / `stop=`         | Required for historic                                |
| Mixing historic and streaming in one script | Studio validation rejects the script                 |
| Historic tick count too large               | Narrow window or increase frequency                  |
| `intent_id=…` in instructions               | Omit; bind via `for <intentRef>`                     |
| Metric not on the intent                    | Use stems from `extract metric-catalog` / Conditions |
| Expecting JS `ctx.*` codegen                | Use constraint NL; this agent renders from schema    |


---



## Related files


| Path                                                        | Role                                      |
| ----------------------------------------------------------- | ----------------------------------------- |
| `tools/syntheticPrompt.ts`                                  | Parses structured globals + metric slices |
| `tools/schemaSynth/nlToSchema.ts`                           | NL → ConstraintDocument                   |
| `tools/schemaSynth/schema/types.ts`                         | ConstraintDocument schema                 |
| `prompt_modules/observe_stream.md`                          | REPL / worker behavior                    |
| `../../experiments/observation-schema-synth/examples/*.dsl` | Lab catalog of the same statement shapes  |
| `../../ObservationAgentRequirements.md`                     | Controller ↔ observation-agent contracts  |


