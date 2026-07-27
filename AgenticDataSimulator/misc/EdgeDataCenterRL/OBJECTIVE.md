# Optimization objective

This document explains what the `EdgeDataCenter-v0` Gymnasium environment is trying to
optimize and what reinforcement learning training is meant to achieve.

## Problem being modeled

Two edge datacenters run the same LLM inference workload. Each site has a fixed
hardware ceiling (`max_capacity`, tokens/sec) and its own electricity price
(`cost_per_kw`, USD/kWh).

Concurrent **sessions** arrive over time. Each session must receive at least
`min_tps` tokens/sec (the SLA floor, default 400). Sessions last for a random
number of steps, then complete.

An external **load balancer** routes new arrivals to the cheapest datacenter that
still has spare hardware capacity, tie-breaking on load. The agent does not
control routing.

The agent's only control is **provisioned capacity** per datacenter each step:
how much token throughput each site makes available for inference.

Power draw follows a simple model:

- **Idle energy** scales with provisioned capacity (keeping capacity warm costs
  power even with no sessions).
- **Throughput energy** scales with tokens actually delivered to sessions.

Delivered throughput per session is capped at `min_tps × delivery_headroom_cap`,
so provisioning far above need does not deliver extra tokens — it mainly wastes
idle power.

## What training is trying to achieve

Training learns a policy that **maximizes cumulative reward** by:

1. **Meeting SLA** — every active session should receive at least `min_tps`.
2. **Minimizing energy cost** — total power spend across both datacenters,
   weighted by local electricity prices.
3. **Right-sizing capacity** — provision just enough headroom for current load,
   not maximum hardware capacity.

In short: **meet minimum throughput for all sessions while spending as little
energy as possible.**

The efficient operating point for a datacenter with active sessions is:

```text
capacity ≈ active_sessions × min_tps × (1 + small_buffer)
```

- Below that → SLA violations.
- Far above that → wasted idle power with little extra delivered throughput.
- Zero capacity with active sessions → **stranded sessions** (heavily penalized).

When a datacenter has no sessions, capacity should be driven toward zero to
avoid idle provisioning cost.

## What the agent controls

| Controlled by agent | Not controlled by agent |
| ------------------- | ----------------------- |
| Provisioned capacity per DC (via 2-dim action) | Session arrivals and routing |
| | Session lifetimes |
| | Electricity price drift |
| | Hardware ceilings |

### Default action semantics (headroom mode)

When sessions are active on a datacenter:

```text
capacity = active_sessions × min_tps × (1 + margin × action)
```

When no sessions are active:

```text
capacity = action × max_capacity
```

Each action component is in `[0, 1]`. Legacy checkpoints may use
`capacity_action_mode="fraction"` instead (`capacity = action × max_capacity`).

## Reward structure

Per-step reward combines several terms that shape the objective:

| Term | Purpose |
| ---- | ------- |
| **Energy cost** | `−sum(energy × cost_per_kw) / scale` — primary drive to minimize power spend |
| **SLA shortfall** | Penalizes sessions below `min_tps`; repeated violations can end the episode |
| **Stranded sessions** | Large penalty when sessions exist but capacity is zero |
| **Over-provisioning** | Penalizes capacity above `sessions × min_tps × buffer` |
| **Idle provisioning** | Penalizes capacity > 0 when a datacenter has no sessions |
| **Throughput waste** | Small penalty for delivering far above the SLA floor |
| **Efficiency bonus** | Rewards sessions with TPS just above `min_tps` |
| **Session completion** | Small bonus when sessions finish naturally |
| **Dropped arrivals** | Penalty when both datacenters have zero capacity |
| **SLA termination** | Large penalty when the episode ends due to sustained SLA violations |

Together these terms discourage two failure modes:

1. **Shutdown exploit** — zero capacity to save power but break SLA.
2. **Max-capacity exploit** — over-provision everything and burn energy.

## Episode success and failure

An episode runs for up to `max_episode_steps` (default 200).

- **Terminated early** when SLA violation steps reach the limit (default 20).
- **Truncated** when the step limit is reached.

A well-trained policy should complete episodes with low energy cost, few SLA
violations, and few dropped or stranded sessions.

## Training setup

`train.py` uses PPO or SAC (Stable-Baselines3) to learn the capacity-control
policy. Typical training conditions:

- **Poisson arrivals** with a curriculum that ramps load from low → medium →
  high over training (default: 4 → 12 → 22 sessions/step).
- **10–40 initial sessions** per datacenter at reset.
- **VecNormalize** on observations and rewards (saved alongside the model for
  evaluation and visualization).

The curriculum starts with low load so the agent learns consolidation and
right-sizing, then increases pressure so the policy stays efficient under
heavier traffic.

## Relation to production

The in-process simulator is a stand-in for a future metrics-backed backend
(e.g. Prometheus). The objective stays the same: dynamically provision
inference capacity across edge sites to honor per-session SLA floors at minimum
energy cost as load and electricity prices change.
