# Edge Data Center RL

A [Gymnasium](https://gymnasium.farama.org/) environment for reinforcement learning on edge data center LLM session scheduling.

The same LLM runs in two edge datacenters with different hardware ceilings. An external load balancer routes new sessions to the site with the lowest load (`active sessions / capacity`). You adjust each datacenter's provisioned capacity to minimize energy cost.

## Quick start

```bash
cd EdgeDataCenterRL
pip install -r requirements.txt
python demo.py
```

Print environment state each step:

```bash
python demo.py --render
```

## Environment: `EdgeDataCenter-v0`


| Property               | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| ID                     | `EdgeDataCenter-v0`                                                   |
| Observation space      | `Box(16,)` — values in `[0, 1]` (8 aggregate features per datacenter) |
| Action space           | `Box(2,)` — capacity fraction in `[0, 1]` per datacenter              |
| Default episode length | 200 steps                                                             |


### Scenario

Two datacenters serve concurrent LLM inference sessions. Each site has its own hardware ceiling (`max_capacity[i]`). The agent sets **provisioned** capacity as a fraction of that ceiling each step. When sessions are active, throughput is split evenly across them (`capacity / active_sessions`).

Every session shares the same `min_tps` (default 400, or similar, this is the Helm chart objective value). Throughput above that floor is fine; only shortfalls are penalized.

New sessions arrive stochastically (Bernoulli trial per step). The load balancer assigns each arrival to the datacenter with the lowest load ratio (`active_sessions / capacity`), skipping sites with zero capacity. There is no cap on how many sessions a datacenter can host.

The agent's only lever is setting each datacenter's provisioned capacity. Higher capacity improves per-session TPS but increases energy draw.

### Energy model

Power draw (kW) per datacenter:

- **Idle**: `idle_energy_kw * (capacity / max_capacity)` — cost of keeping capacity provisioned, even with no active sessions.
- **Throughput** (when sessions are active): `+ throughput_energy_kw * accumulated_tps` — marginal power from tokens actually delivered.

Per-step energy cost in the reward: `sum(energy * cost_per_kw)` across both datacenters.

### Observations

The observation vector contains the same signals for each datacenter, in order (DC0, then DC1):


| Field                   | Meaning                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| Capacity                | Provisioned throughput, normalized by that DC's `max_capacity`                  |
| Energy                  | Normalized current power draw (kW), scaled per DC                               |
| Cost per kW             | Normalized electricity cost                                                     |
| Active sessions         | Session count / `session_count_scale` (default scale: 256)                      |
| Accumulated TPS         | Sum of per-session TPS, normalized by that DC's `max_capacity`                  |
| SLA pressure            | `active_sessions * min_tps / capacity`, clipped to `[0, 1]` (0.5 = at SLA edge) |
| SLA headroom            | Per-session TPS / `min_tps`, clipped to `[0, 1]` (1.0 = at or above floor)      |
| Mean remaining duration | Average `remaining_steps` / max session duration                                |


Each datacenter contributes 8 aggregate values (16 total). These summaries scale to hundreds of sessions without encoding individual session rows. Capacity, energy, and TPS are normalized **per datacenter** using that site's `max_capacity`. Full per-session detail remains in `info["datacenters"][i]["sessions"]`.

`session_count_scale` is the reference peak session count used to map `active_sessions` into `[0, 1]` for the observation (e.g. 128 sessions with scale 256 → 0.5). It does not cap simulated sessions — set it near the busiest load you expect per datacenter so the agent can distinguish low vs high session counts before the value clips at 1.0.

### How state changes each step

Gymnasium updates state only through `reset()` (initial state) and `step(action)` (each timestep). The agent controls capacity; everything else follows fixed rules plus a small amount of randomness.

#### Internal state

Each datacenter tracks:

- `max_capacity` — hardware ceiling for that site (tokens/sec; fixed for the episode)
- `capacity` — provisioned token throughput (tokens/sec), set by the agent each step
- `energy` — current power draw (kW)
- `cost_per_kw` — electricity price
- `sessions` — active LLM sessions, each with `min_tps`, `current_tps`, and `remaining_steps`

Global counters track completed/dropped sessions and SLA violation steps.

#### `reset()` — initial state

1. Each datacenter is created with a fixed `max_capacity` from the constructor tuple (default: 200,000 and 150,000 tokens/sec).
2. Starting **provisioned** capacity is random at 35–55% of that site's `max_capacity`; electricity cost is sampled from `base_cost_per_kw`.
3. Each datacenter starts with 1–3 sessions. Every session uses the global `min_tps` and a random lifetime from `session_duration_range`.
4. Per-session TPS and energy are computed from those values.

#### `step(action)` — one timestep

Each step runs in this order:

1. **Capacity** — `capacity[i] = action[i] * max_capacity[i]`.
2. **TPS and energy (first pass)** — fair-share TPS and power from provisioned capacity and throughput.
3. **Cost per kW** — drifts slowly on a sine wave, slightly offset per datacenter.
4. **Reward** — energy cost, SLA penalties, possible arrival penalty, and session-completion bonus (see Reward).
5. **New sessions** — Bernoulli trial with probability `arrival_rate` (default 40%). If a session arrives, the load balancer routes it to the lowest `active_sessions / capacity` among sites with capacity > 0. If both sites have zero capacity, the session is dropped (−2.0 reward).
6. **Session aging** — each session's `remaining_steps` decreases by 1; finished sessions are removed (+0.5 reward each).
7. **TPS and energy (second pass)** — recalculated after arrivals and completions.
8. **Observation** — the normalized `Box(16,)` vector is built from the updated internal state.

The observation is a normalized snapshot of aggregate state. Individual sessions are still simulated and appear in `info["datacenters"][i]["sessions"]`.

### Actions


| Index | Effect                                            |
| ----- | ------------------------------------------------- |
| 0     | Set DC0 capacity to `action[0] * max_capacity[0]` |
| 1     | Set DC1 capacity to `action[1] * max_capacity[1]` |


### Reward

Per-step reward combines:

- **Energy cost**: `−sum(energy * cost_per_kw)` across both datacenters
- **SLA shortfall**: `−1.5 × (min_tps − current_tps) / min_tps` per violating session; any step with at least one violation increments `sla_violations`
- **Session completion**: `+0.5` per session that reaches `remaining_steps == 0`
- **Dropped session**: `−2.0` when an arrival occurs but both datacenters have zero capacity

### Episode end

An episode ends when:

- **Terminated**: SLA violation steps reach the limit (default: 20 steps with any under-provisioned session)
- **Truncated**: the step limit is reached (default: 200)

## Usage in code

```python
from edge_datacenter_env import make_env

env = make_env(max_episode_steps=200, render_mode="human")
observation, info = env.reset(seed=0)

terminated = truncated = False
while not (terminated or truncated):
    action = env.action_space.sample()
    observation, reward, terminated, truncated, info = env.step(action)

env.close()
```

You can also register and load the environment by ID when running from this directory:

```python
import gymnasium as gym
import edge_datacenter_env  # registers EdgeDataCenter-v0

env = gym.make("EdgeDataCenter-v0")
```

The `info` dict includes per-datacenter detail and global counters:

```python
for dc in info["datacenters"]:
    print(
        dc["capacity"],
        dc["active_sessions"],
        dc["sla_pressure"],
        dc["sla_headroom"],
        dc["mean_remaining_steps"],
    )
print(info["completed_sessions"], info["dropped_sessions"], info["sla_violations"])
```

## Files


| File                     | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `edge_datacenter_env.py` | Environment implementation and `make_env()` factory |
| `demo.py`                | Random-policy demo script                           |
| `requirements.txt`       | Python dependencies                                 |


## Configuration

`EdgeDataCenterEnv` accepts optional parameters for tuning difficulty:

- `session_count_scale` — reference peak session count for normalizing `active_sessions` in the observation (default: 256; not a simulation limit)
- `max_capacity` — hardware ceiling per site as a 2-tuple in tokens/sec (default: `(200000, 150000)`)
- `arrival_rate` — probability of a new session per step (default: 0.40)
- `min_tps` — minimum TPS per session from Helm chart SLA (default: 400)
- `session_duration_range` — how long sessions stay active in steps (default: 20–60)
- `base_cost_per_kw` — electricity cost range per DC (default: 0.08–0.18)
- `idle_energy_kw` — baseline power at full provisioned capacity (default: 2.0 kW)
- `throughput_energy_kw` — marginal power per token/sec delivered (default: 0.04)
- `max_sla_violations` — steps with any TPS shortfall before termination (default: 20)

## Future work

The current simulator uses a simple fair-share TPS model (`capacity / active_sessions`) suited for RL prototyping. A more realistic version could replace that with mechanics closer to production LLM serving:

- **Batching** — sessions wait in a queue; tokens are generated in batches (higher throughput, higher latency).
- **Prefill vs decode** — separate prefill TPS and decode TPS per session.
- **KV-cache pressure** — memory limits how many sessions fit, not just TPS.
- **Non-linear capacity curve** — throughput rises with batch size but saturates; power rises super-linearly at high utilization.
- **Heterogeneous sessions** — different context lengths, model sizes, or burstiness.

Other extensions worth exploring:

- Capacity ramp-up and ramp-down delays instead of instant changes.
- Trace-driven arrivals and energy curves calibrated from benchmark or production data.
- Richer load-balancing (latency, queue depth, session stickiness).

### Prometheus-backed state

Today, `step()` advances state with **in-process rules**: fair-share TPS, Bernoulli arrivals, session aging, sine-wave electricity cost, and derived energy. That keeps training self-contained and fast.

An alternative is to **replace those rule-based updates with readings from Prometheus**, while keeping the Gymnasium interface (action → observation → reward). The physics then live in an **external data-generating simulator** that exposes the same quantities production would — session counts, throughput, power, SLA signals — as time series. Prometheus scrapes the simulator's `/metrics` endpoint (pull) or receives samples via a push gateway or remote write (push).

```text
  RL agent                    Gymnasium env (thin adapter)
      |                              |
      |  action (capacity fraction)  |
      |----------------------------->|  apply action (e.g. PATCH Helm / scale API)
      |                              |
      |                              |  PromQL instant/range query
      |                              v
      |                        Prometheus  <--- scrape or push ---  External simulator
      |                              |
      |  observation (Box 16)        |  map metrics -> normalized obs
      |<-----------------------------|
      |  reward (computed in env     |  optional: query cost/SLA counters
      |   or from metric deltas)     |
```

**What moves out of the env**

| Current in-code logic | Prometheus / simulator source |
| --------------------- | --------------------------- |
| `_update_throughput_and_energy()` | `llm_tokens_per_second`, `datacenter_power_kw`, GPU utilization |
| `_vary_cost_per_kw()` | `electricity_price_per_kwh{dc="..."}` or infra graph export |
| `_route_new_session()` / `_advance_sessions()` | `active_sessions`, `sessions_completed_total`, `sessions_dropped_total` (simulator models LB + churn) |
| `_apply_sla_penalties()` | `sla_violations_total`, `per_session_tps`, or recording rules on `min_tps` |
| Internal `DataCenter` session list | Optional in `info` only; obs uses aggregates the simulator already exports |

The env becomes a **metrics adapter**: on each step it (1) applies the agent's capacity action to the simulator or a control plane stub, (2) waits one decision interval, (3) queries Prometheus for the latest values, (4) normalizes them into the same 16-dimensional observation, (5) computes reward from metrics or cached deltas.

**Example metric mapping (per datacenter)**

Labels such as `dc="dc0"` keep sites separable. Names are illustrative — align with your simulator and Helm chart exports.

| Observation feature | Example PromQL (instant query at step time) |
| ------------------- | ------------------------------------------- |
| Capacity | `llm_provisioned_tps{dc="dc0"}` |
| Energy | `datacenter_power_kw{dc="dc0"}` |
| Cost per kW | `electricity_price_per_kwh{dc="dc0"}` |
| Active sessions | `active_sessions{dc="dc0"}` |
| Accumulated TPS | `sum(llm_tokens_per_second{dc="dc0"})` |
| SLA pressure | `active_sessions{dc="dc0"} * $min_tps / llm_provisioned_tps{dc="dc0"}` |
| SLA headroom | `avg(llm_tokens_per_second{dc="dc0"}) / $min_tps` |
| Mean remaining duration | `avg(session_remaining_seconds{dc="dc0"})` normalized by max duration |

`max_capacity` for normalization can be a constant per DC, or a metric like `llm_max_tps{dc="dc0"}` set from hardware specs.

**Simulator responsibilities**

The external simulator (not this repo) should:

- Advance time on a fixed tick aligned with the RL step (e.g. every 1–30 s).
- Model arrivals, load balancing, session lifetimes, and throughput at least as richly as needed for training.
- Export counters and gauges Prometheus can scrape, or push on the same interval.
- Accept capacity changes from the env (HTTP API, message queue, or file the simulator watches) so actions affect the next scrape window.

Pull (scrape) fits long-running simulators with a stable HTTP metrics port. Push suits ephemeral jobs or when the simulator cannot be scraped directly.

**Implementation sketch**

No Prometheus client exists yet. A typical refactor would:

1. Introduce a `StateBackend` protocol with `reset()` and `step(action) -> RawMetrics`.
2. Keep `RuleBasedBackend` (current `edge_datacenter_env.py` logic) for offline RL.
3. Add `PrometheusBackend` using `prometheus-api-client` or HTTP queries against `prometheus_url`.
4. Share `_datacenter_observation()` normalization so both backends produce `Box(16,)`.
5. Drive `step()` cadence with `step_interval_seconds` and optionally `time.sleep` or async wait until `timestamp >= t + interval`.

Episode termination can still use `sla_violations` and `max_episode_steps`, either computed in the env from queried metrics or read from `sla_violation_steps_total` in Prometheus.

**Operational notes**

- **Staleness** — use the same `lookback` / `timestamp` on every query in a step so DC0 and DC1 are consistent.
- **Step vs scrape interval** — RL step should be ≥ Prometheus scrape interval (or push period) to avoid reading duplicate samples.
- **Training vs production** — the simulator path validates metric names, normalization, and control loops; production later swaps the simulator URL for real cluster metrics with the same PromQL shape where possible.

### Cyclical time in observations

An external simulator (or production metrics) will often show **hourly and daily patterns**: time-of-use electricity pricing, diurnal session arrival rates, and predictable load cycles. The current `Box(16,)` observation has no explicit time features, so the same capacity/energy/session snapshot can mean different things at 03:00 vs 17:00 — the MDP becomes **partially observed** unless the agent infers time from lagging signals.

When Prometheus-backed state (or trace-driven simulation) is added, append **cyclical time features** to the observation vector. Use **simulation clock** time (e.g. from a `simulation_time_seconds` metric or the Prometheus query timestamp), not wall-clock time during training.

Do **not** put a raw Unix timestamp in obs (unbounded, poor generalization). Encode periodicity with sin/cos:

| Feature | Encoding | Dims |
| ------- | -------- | ---- |
| Hour of day | `sin(2π · hour / 24)`, `cos(2π · hour / 24)` | 2 |
| Day of week | `sin(2π · dow / 7)`, `cos(2π · dow / 7)` | 2 |

Optional: day-of-year for seasonal patterns (+2 dims). These are **global** features (once per step, shared across datacenters), e.g. extending `Box(16,)` to `Box(20,)`.

Time in obs is most useful when periodic drivers are **not fully visible** in other features — e.g. arrivals rise before `active_sessions` catches up, even if `cost_per_kw` already reflects time-of-use pricing. Put the raw simulation timestamp in `info` for debugging; only cyclic encodings belong in the policy observation.

The in-process rule-based env today varies cost by step index, not clock time, so time features are unnecessary there. Use the same cyclic encoding for both backends if you want one policy architecture across offline training and Prometheus-backed runs.

## Next steps

A random capacity policy wastes energy and often breaches minimum TPS. Train an agent (e.g. PPO or SAC) to learn when to scale each datacenter up or down as session load and electricity costs shift.