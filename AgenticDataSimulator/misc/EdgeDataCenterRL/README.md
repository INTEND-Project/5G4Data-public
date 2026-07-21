# Edge Data Center RL

A [Gymnasium](https://gymnasium.farama.org/) environment for reinforcement learning on edge data center LLM session scheduling.

The same LLM runs in two edge datacenters with different hardware ceilings. An external load balancer routes new sessions to the **cheapest datacenter until its hardware SLA session limit** (`max_capacity / min_tps`, tie-break: lowest load ratio), then spills to the next cheapest. You adjust each datacenter's provisioned capacity to minimize energy cost.

## Quick start

```bash
cd EdgeDataCenterRL
pip install -r requirements.txt
python demo.py
```

### Dev container

Open this folder in Cursor or VS Code and choose **Reopen in Container** (Dev Containers extension). Dependencies install automatically on first build; then run:

```bash
python demo.py
```

Print environment state each step:

```bash
python demo.py --render
```

## Training

Train a policy with [Stable-Baselines3](https://stable-baselines3.readthedocs.io/) (PPO by default). Training uses **Poisson arrivals** and a **mixed-load curriculum** (λ 4 → 12 → 22) with extended low-load time so the policy learns right-sizing before peak saturation:

```bash
python train.py \
  --timesteps 1000000 \
  --n-envs 16 \
  --save-path models/edge_dc_ppo_v7 \
  --tensorboard-log tb_logs/ppo_run7
```

Common options:

```bash
# SAC, fixed high load (no curriculum)
python train.py --algorithm sac --no-curriculum --arrival-rate-end 22 --n-envs 8

# Tune initial load and observation scaling for heavy traffic
python train.py --initial-sessions-min 20 --initial-sessions-max 60 --session-count-scale 1024
```

| Flag | Default (train) | Purpose |
| ---- | --------------- | ------- |
| `--arrival-rate-start` | 4.0 | Phase 1 low load (0–50% of training) |
| `--arrival-rate-mid` | 12.0 | Phase 2 target (ramps 50–75%) |
| `--arrival-rate-end` | 22.0 | Phase 3–4 peak (ramps 75–90%, hold 90–100%) |
| `--arrival-mode` | poisson | `poisson` (training) or `bernoulli` (demo-style) |
| `--initial-sessions-min/max` | 10 / 40 | Sessions per DC at `reset()` |
| `--session-duration-min/max` | 20 / 60 | Session lifetime range (steps) |
| `--session-count-scale` | 1024 | Obs normalization for high session counts |
| `--no-curriculum` | off | Keep `--arrival-rate-end` fixed |

Monitor training:

```bash
tensorboard --logdir tb_logs
```

Evaluate at low and high load (v7 policies need retraining; obs/action semantics changed):

```bash
# Right-sizing check
python eval.py --model-path models/edge_dc_ppo_v7 --arrival-rate 4 --arrival-mode poisson --episodes 10

# Peak load
python eval.py --model-path models/edge_dc_ppo_v7 --arrival-rate 22 --arrival-mode poisson --episodes 10
```

**Note:** `rollout/ep_rew_mean` in TensorBoard reflects **normalized** training rewards when VecNormalize is enabled. Use `eval.py` and `info` counters (`completed`, `dropped`, `sla_violations`, `stranded_sessions`, episode length) to judge policy quality.

| Script          | Purpose                                      |
| --------------- | -------------------------------------------- |
| `train.py`      | Train PPO or SAC; saves to `models/`         |
| `eval.py`       | Load a checkpoint and run deterministic rollouts |
| `visualize.py`  | Animated scene of a trained-policy episode     |
| `app.py`        | Streamlit control panel for the visualization  |
| `schedules.py`  | Cost / arrival-rate schedule generators        |
| `env_config.py` | Shared env defaults and CLI helpers            |

## Visualization

Render one trained-policy episode as an animated scene (GIF or MP4):

```bash
python visualize.py --model-path models/edge_dc_ppo_v5 --out run.gif
```

The scene shows:

- A **load balancer** at the top with incoming session dots, routing arrows, and two split bars showing each datacenter's share of recent arrivals (last 20 steps). The split shifts as the agent adjusts capacity.
- Per datacenter: a **barrel** filled by accumulated TPS (fraction of `max_capacity`) with a dashed marker for the agent's provisioned capacity, a **battery indicator** for energy draw (green/yellow/red) with the current **electricity price (USD/kWh)** above it, and a **mean per-session TPS bar** with the `min_tps` SLA floor marked (turns red on SLA breach).
- A **status strip** with the step reward, session counters, and SLA violation steps.

Useful options: `--max-episode-steps 60` for a shorter clip, `--fps`/`--smooth` for animation pacing, `--out run.mp4` (needs ffmpeg), `--live` for an interactive window, plus the same environment flags as `eval.py`.

### Interactive visualization (Streamlit)

An alternative browser front-end with knobs for the run conditions:

```bash
streamlit run app.py
```

Open http://localhost:8501 (the dev container forwards port 8501). Knobs, prefilled with the defaults:

**Initial state** (at `reset()`, before the agent acts):

- Per-datacenter **max capacity** (hardware ceiling, tokens/sec)
- Per-datacenter **provisioned capacity** (% of max at reset)
- Per-datacenter **active session count**
- **min TPS** (SLA floor) and **session count scale** (observation normalization)
- **Initial session remaining steps** (fixed, or random from the new-session duration range)
- **New session duration** min/max (for arrivals during the episode)

**Variation over episode**:

- **Cost per kW per datacenter** — fixed value, or vary between min/max as a sine wave, ramp up/down, or random walk
- **Incoming sessions per step** — fixed (default 22) or varying with the same patterns; Poisson or Bernoulli arrival process

**Episode settings** in the sidebar: seed, model (dropdown from `models/`), algorithm

**Animation** in the sidebar: **steps to visualize** (10–500, default 100), fps, smooth

An expandable summary table shows the composed step-0 state. Charts preview the scheduled cost and arrival-rate profiles. Nothing runs until you click **Run**; then the trained policy is rolled out and the animation plus episode metrics appear. The `visualize.py` CLI keeps working independently.

## Environment: `EdgeDataCenter-v0`


| Property               | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| ID                     | `EdgeDataCenter-v0`                                                   |
| Observation space      | `Box(20,)` — values in `[0, 1]` (10 aggregate features per datacenter) |
| Action space           | `Box(2,)` — headroom multiplier in `[0, 1]` per datacenter (see Actions) |
| Default episode length | 200 steps                                                             |


### Scenario

Two datacenters serve concurrent LLM inference sessions. Each site has its own hardware ceiling (`max_capacity[i]`). The agent sets **provisioned** capacity each step using **headroom actions** (default): when sessions are active, `capacity = active_sessions × min_tps × (1 + margin × action)` (clipped to `max_capacity`). When a site has no sessions, `capacity = action × max_capacity`.

When sessions are active, fair-share delivery is capped: each session receives `min(capacity / active_sessions, min_tps × delivery_headroom_cap)`. Throughput energy bills **delivered** tokens only; idle energy still scales with provisioned capacity.

Every session shares the same `min_tps` (default 400, or similar, this is the Helm chart objective value). Throughput above that floor is fine; only shortfalls are penalized.

New sessions arrive each step via **Bernoulli** (demo default) or **Poisson** (training). The load balancer sends each arrival to the **cheapest datacenter that is below its hardware session limit** (`active_sessions < max_capacity / min_tps`) and has `capacity > 0`, tie-breaking on load ratio. Once the cheapest site is full at that limit, arrivals spill to the next cheapest. If every site is at its hardware limit but still has `capacity > 0`, arrivals overload onto the cheapest site anyway. Sites with zero capacity are skipped. Hardware SLA session limits are `max_capacity / min_tps` per site (**500** on DC0, **375** on DC1, **875** combined at defaults).

**Stranded sessions** are active sessions on a datacenter with `capacity = 0`. They are heavily penalized. When `enable_session_migration` is on (default), sessions on a zero-capacity site **automatically move** to another datacenter below its hardware session limit, preferring the **cheaper** site — enabling valid single-DC consolidation without stranding.

The agent's only lever is setting each datacenter's provisioned capacity. Higher capacity improves per-session TPS but increases energy draw.

### Energy model

Power draw (kW) per datacenter:

- **Idle**: `idle_energy_kw * (capacity / max_capacity)` — cost of keeping capacity provisioned, even with no active sessions.
- **Throughput** (when sessions are active): `+ throughput_energy_kw * accumulated_tps` — marginal power from tokens **actually delivered** (capped per session).

Per-step energy cost in the reward: `sum(energy * cost_per_kw)` across both datacenters.

### Observations

The observation vector contains the same signals for each datacenter, in order (DC0, then DC1):


| Field                   | Meaning                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| Capacity                | Provisioned throughput, normalized by that DC's `max_capacity`                  |
| Energy                  | Normalized current power draw (kW), scaled per DC                               |
| Cost per kW             | Normalized electricity cost                                                     |
| Active sessions         | Session count / `session_count_scale` (demo: 256; training: 1024)               |
| Accumulated TPS         | Sum of per-session TPS, normalized by that DC's `max_capacity`                  |
| SLA pressure            | `active_sessions * min_tps / capacity`, clipped to `[0, 1]` (0.5 = at SLA edge) |
| SLA headroom            | Mean delivered TPS / `min_tps`, clipped to `[0, 1]` (1.0 = at or above floor) |
| Mean remaining duration | Average `remaining_steps` / max session duration                                |
| Required capacity       | `active_sessions × min_tps / max_capacity`, clipped to `[0, 1]`                 |
| Capacity excess         | `(capacity / required) − 1`, normalized by headroom margin                    |


Each datacenter contributes 10 aggregate values (20 total). These summaries scale to hundreds of sessions without encoding individual session rows. Capacity, energy, and TPS are normalized **per datacenter** using that site's `max_capacity`. Full per-session detail remains in `info["datacenters"][i]["sessions"]`.

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
3. Each datacenter starts with `initial_sessions_range` sessions (demo default: 1–3; training default: 10–40).
4. Per-session TPS and energy are computed from those values.

#### `step(action)` — one timestep

Each step runs in this order:

1. **Capacity** — headroom mode (default): `capacity[i] = sessions[i] × min_tps × (1 + margin × action[i])` when `sessions[i] > 0`, else `action[i] × max_capacity[i]`. Legacy `fraction` mode: `capacity[i] = action[i] × max_capacity[i]`.
2. **Session migration** — sessions on zero-capacity sites move to cheaper DCs with spare SLA capacity (if enabled).
3. **TPS and energy (first pass)** — fair-share delivery capped at `min_tps × delivery_headroom_cap`; power from provisioned capacity (idle) and delivered throughput.
4. **Cost per kW** — drifts slowly on a sine wave, slightly offset per datacenter.
5. **Reward** — energy cost, SLA penalties, possible arrival penalty, and session-completion bonus (see Reward).
6. **New sessions** — sample `arrival_count` from Bernoulli or Poisson (`arrival_mode`). Route each arrival via the load balancer; dropped if both sites have zero capacity.
7. **Session aging** — each session's `remaining_steps` decreases by 1; finished sessions are removed (`session_completion_reward`, default +2 each).
8. **TPS and energy (second pass)** — recalculated after arrivals and completions.
9. **Observation** — the normalized `Box(20,)` vector is built from the updated internal state.

The observation is a normalized snapshot of aggregate state. Individual sessions are still simulated and appear in `info["datacenters"][i]["sessions"]`.

### Actions


| Index | Effect (headroom mode, default) |
| ----- | --------------------------------- |
| 0     | DC0 capacity: `sessions × min_tps × (1 + 0.10 × action[0])` when sessions > 0; else `action[0] × max_capacity[0]` |
| 1     | DC1 capacity: same formula for DC1 |

Set `capacity_action_mode="fraction"` for legacy `action × max_capacity` semantics (v5 and earlier checkpoints).


### Optimization objective

The agent should keep every session **just above** the minimum TPS floor (`min_tps`) while **minimizing total energy** across both datacenters.

With capped fair-share delivery, each session receives up to `min_tps × delivery_headroom_cap` tokens/sec. The energy-efficient setpoint for a datacenter with active sessions is:

```text
capacity ≈ active_sessions × min_tps × (1 + small_buffer)
```

Provisioned capacity below that risks SLA violations; far above it wastes idle power without delivering extra tokens. When a datacenter has no sessions, capacity should be driven toward zero to avoid idle provisioning cost.

### Reward

Per-step reward combines:

- **Energy cost**: `−sum(energy * cost_per_kw) / energy_cost_scale` across both datacenters (default scale: 120)
- **SLA shortfall**: `−sla_penalty_weight × (min_tps − current_tps) / min_tps` per violating session (default weight: 50); any step with at least one violation increments `sla_violations`
- **Stranded sessions**: `−stranded_session_penalty_weight × active_sessions` per DC with sessions but zero capacity (default weight: 100 per session)
- **SLA termination**: `−sla_termination_penalty` when the episode ends due to sustained SLA violations (default: 1000)
- **Over-provisioning**: linear + quadratic penalty on capacity above `active_sessions × min_tps × overprovision_buffer` (default weight: 200)
- **Throughput waste**: `−throughput_waste_penalty_weight × (current_tps − min_tps) / min_tps` per session above the floor (default weight: 1.5)
- **Idle provisioning**: `−idle_provision_penalty_weight × capacity / max_capacity` when a datacenter has no sessions but capacity > 0 (default weight: 12)
- **Efficiency bonus**: `+efficiency_bonus_weight × closeness` per session with TPS in `[min_tps, min_tps × efficiency_headroom_max]` (defaults: weight 0.75, headroom 1.05)
- **Session completion**: `+session_completion_reward` per session that reaches `remaining_steps == 0` (default: 2)
- **Dropped session**: `−dropped_session_penalty` when an arrival occurs but both datacenters have zero capacity (default: 25)

Together, these terms penalize both **shutdown exploits** (zero capacity) and **max-capacity exploits** (over-provisioning), while rewarding right-sized throughput.

`train.py` also wraps environments in **VecNormalize** (observations and rewards) by default; stats are saved as `{save-path}_vecnormalize.pkl` for `eval.py`.

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
| `train.py`               | Train PPO or SAC with Stable-Baselines3             |
| `eval.py`                | Evaluate a saved policy                             |
| `visualize.py`           | Animated visualization of a trained-policy episode  |
| `app.py`                 | Streamlit control panel with cost/arrival knobs     |
| `schedules.py`           | Schedule generators (fixed, sine, ramp, random walk) |
| `env_config.py`          | Shared env defaults and CLI helpers                 |
| `requirements.txt`       | Python dependencies                                 |


## Configuration

`EdgeDataCenterEnv` accepts optional parameters for tuning difficulty:

- `session_count_scale` — reference peak session count for normalizing `active_sessions` in the observation (default: 256; not a simulation limit)
- `max_capacity` — hardware ceiling per site as a 2-tuple in tokens/sec (default: `(200000, 150000)`)
- `arrival_rate` — Bernoulli probability or Poisson mean arrivals per step (demo: 0.40)
- `arrival_mode` — `bernoulli` or `poisson` (training uses `poisson`)
- `initial_sessions_range` — inclusive session count range per DC at `reset()` (demo: 1–3)
- `min_tps` — minimum TPS per session from Helm chart SLA (default: 400)
- `session_duration_range` — how long sessions stay active in steps (default: 20–60)
- `base_cost_per_kw` — electricity cost range per DC (default: 0.08–0.18)
- `idle_energy_kw` — baseline power at full provisioned capacity (default: 2.0 kW)
- `throughput_energy_kw` — marginal power per token/sec delivered (default: 0.04)
- `delivery_headroom_cap` — max delivered TPS per session as multiple of `min_tps` (default: 1.05)
- `capacity_action_mode` — `headroom` (default) or `fraction` (legacy)
- `capacity_headroom_margin` — action maps to up to this fraction above SLA floor (default: 0.10)
- `overprovision_buffer` — capacity multiple of SLA floor before over-provision penalty (default: 1.02)
- `max_sla_violations` — steps with any TPS shortfall before termination (default: 20)
- `energy_cost_scale` — divides raw energy cost in the reward (default: 120)
- `sla_penalty_weight` — multiplier for per-session SLA shortfall penalty (default: 50)
- `dropped_session_penalty` — reward when a session is dropped (default: 25)
- `session_completion_reward` — reward per completed session (default: 2)
- `stranded_session_penalty_weight` — per stranded session per step when capacity is zero (default: 100)
- `sla_termination_penalty` — penalty when episode terminates on SLA violations (default: 1000)
- `enable_session_migration` — move sessions off zero-capacity DCs when spare capacity exists (default: true)
- `overprovision_penalty_weight` — penalizes capacity above `active_sessions × min_tps × overprovision_buffer` (default: 200)
- `throughput_waste_penalty_weight` — penalizes per-session TPS above the floor (default: 1.5)
- `idle_provision_penalty_weight` — penalizes provisioned capacity when a DC has no sessions (default: 12)
- `efficiency_bonus_weight` — bonus for sessions just above the TPS floor (default: 0.75)
- `efficiency_headroom_max` — upper headroom ratio for the efficiency bonus (default: 1.05)
- `cheapest_dc_routing` — fill cheapest DC until `max_capacity / min_tps`, then spill (default: true)

## Future work

The current simulator uses capped fair-share TPS delivery suited for RL prototyping. A more realistic version could replace that with mechanics closer to production LLM serving:

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
      |  observation (Box 20)        |  map metrics -> normalized obs
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
4. Share `_datacenter_observation()` normalization so both backends produce `Box(20,)`.
5. Drive `step()` cadence with `step_interval_seconds` and optionally `time.sleep` or async wait until `timestamp >= t + interval`.

Episode termination can still use `sla_violations` and `max_episode_steps`, either computed in the env from queried metrics or read from `sla_violation_steps_total` in Prometheus.

**Operational notes**

- **Staleness** — use the same `lookback` / `timestamp` on every query in a step so DC0 and DC1 are consistent.
- **Step vs scrape interval** — RL step should be ≥ Prometheus scrape interval (or push period) to avoid reading duplicate samples.
- **Training vs production** — the simulator path validates metric names, normalization, and control loops; production later swaps the simulator URL for real cluster metrics with the same PromQL shape where possible.

### Cyclical time in observations

An external simulator (or production metrics) will often show **hourly and daily patterns**: time-of-use electricity pricing, diurnal session arrival rates, and predictable load cycles. The current `Box(20,)` observation has no explicit time features, so the same capacity/energy/session snapshot can mean different things at 03:00 vs 17:00 — the MDP becomes **partially observed** unless the agent infers time from lagging signals.

When Prometheus-backed state (or trace-driven simulation) is added, append **cyclical time features** to the observation vector. Use **simulation clock** time (e.g. from a `simulation_time_seconds` metric or the Prometheus query timestamp), not wall-clock time during training.

Do **not** put a raw Unix timestamp in obs (unbounded, poor generalization). Encode periodicity with sin/cos:

| Feature | Encoding | Dims |
| ------- | -------- | ---- |
| Hour of day | `sin(2π · hour / 24)`, `cos(2π · hour / 24)` | 2 |
| Day of week | `sin(2π · dow / 7)`, `cos(2π · dow / 7)` | 2 |

Optional: day-of-year for seasonal patterns (+2 dims). These are **global** features (once per step, shared across datacenters), e.g. extending `Box(20,)` to `Box(24,)`.

Time in obs is most useful when periodic drivers are **not fully visible** in other features — e.g. arrivals rise before `active_sessions` catches up, even if `cost_per_kw` already reflects time-of-use pricing. Put the raw simulation timestamp in `info` for debugging; only cyclic encodings belong in the policy observation.

The in-process rule-based env today varies cost by step index, not clock time, so time features are unnecessary there. Use the same cyclic encoding for both backends if you want one policy architecture across offline training and Prometheus-backed runs.

## Next steps

- Tune `train.py` hyperparameters (`--timesteps`, `--n-envs`, `--learning-rate`) for your hardware.
- Compare `demo.py` (random) vs `eval.py` (trained) on mean reward and `sla_violations`.
- Experiment with env difficulty via `EdgeDataCenterEnv` constructor options (see Configuration).