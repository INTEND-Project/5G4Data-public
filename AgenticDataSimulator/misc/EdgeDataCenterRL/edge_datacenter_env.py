"""Edge data center LLM session scheduling environment for Gymnasium."""
from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

ENV_ID = "EdgeDataCenter-v0"
DEFAULT_MAX_EPISODE_STEPS = 200
NUM_DATACENTERS = 2
OBS_FEATURES_PER_DC = 10
# Per-datacenter observation feature names (v8 = legacy 16-dim models, v10 = current).
DC_OBS_FEATURES_V8 = (
    "capacity",
    "energy",
    "cost",
    "active_sessions",
    "accumulated_tps",
    "sla_pressure",
    "sla_headroom",
    "mean_remaining_steps",
)
DC_OBS_FEATURES_V10 = DC_OBS_FEATURES_V8 + (
    "required_capacity",
    "capacity_excess",
)
SUPPORTED_OBS_FEATURES_PER_DC = (8, 10)
CAPACITY_ACTION_MODES = ("fraction", "headroom")
ARRIVAL_MODES = ("bernoulli", "poisson")


@dataclass
class LLMSession:
    min_tps: float
    current_tps: float = 0.0
    remaining_steps: int = 0


@dataclass
class DataCenter:
    capacity: float
    max_capacity: float
    energy: float = 0.0
    cost_per_kw: float = 0.12
    sessions: list[LLMSession] = field(default_factory=list)

    @property
    def accumulated_tps(self) -> float:
        return sum(session.current_tps for session in self.sessions)

    @property
    def active_sessions(self) -> int:
        return len(self.sessions)

    def load_ratio(self) -> float:
        if self.capacity <= 0:
            return float("inf")
        return self.active_sessions / self.capacity


class EdgeDataCenterEnv(gym.Env):
    """
    Manage LLM inference capacity across two edge datacenters.

    The same LLM runs in both sites. An external load balancer routes new
    sessions to the cheapest datacenter until its hardware SLA session limit
    (max_capacity / min_tps), tie-breaking on load (active sessions / capacity).
    The agent sets each datacenter's
    provisioned capacity (headroom mode: sessions * min_tps * (1 + margin *
    action)) to minimize energy while meeting per-session minimum TPS.
    Delivered throughput per session is capped at min_tps * delivery_headroom_cap.
    """

    metadata = {"render_modes": ["human", "ansi"], "render_fps": 4}

    def __init__(
        self,
        *,
        max_episode_steps: int = DEFAULT_MAX_EPISODE_STEPS,
        session_count_scale: float = 256.0,
        # Peak token throughput per DC in tokens/sec (hardware ceiling per site). Should be calculated 
        # based on edge data center capacity and hardware specs
        max_capacity: tuple[float, float] = (200_000.0, 150_000.0),
        # Arrivals per step: Bernoulli trial (rate in (0,1]) or Poisson mean (rate can be >1).
        arrival_rate: float = 0.40,
        arrival_mode: str = "bernoulli",
        initial_sessions_range: tuple[int, int] = (1, 3),
        min_tps: float = 400.0,
        # How long a session lasts in steps (e.g. randomly between 20 and 60 steps)
        session_duration_range: tuple[int, int] = (20, 60),
        # Should be taken from infrastructure graph
        base_cost_per_kw: tuple[float, float] = (0.08, 0.18),
        # Simulates baseline / fixed power from keeping a site provisioned at a given capacity level.
        idle_energy_kw: float = 2.0,
        # Simulates marginal extra power consumption from doing inference work
        # It is anextra draw that grows with tokens/sec actually delivered.
        # It scales linearly with accumulated_tps (sum of per-session TPS). 
        # Example at defaults: 10,000 TPS → 0.04 × 10,000 = 400 kW on top of the idle term.
        throughput_energy_kw: float = 0.04,
        max_sla_violations: int = 20,
        # Delivered per-session TPS is capped at min_tps * delivery_headroom_cap so
        # provisioned capacity above need does not burn throughput energy.
        delivery_headroom_cap: float = 1.05,
        # Action semantics: "headroom" maps action in [0,1] to
        # capacity = sessions * min_tps * (1 + margin * action); "fraction" uses
        # capacity = action * max_capacity (legacy).
        capacity_action_mode: str = "headroom",
        capacity_headroom_margin: float = 0.10,
        overprovision_buffer: float = 1.02,
        # Reward shaping — tuned for SLA compliance with minimal energy:
        # provision capacity close to active_sessions * min_tps per datacenter.
        energy_cost_scale: float = 120.0,
        sla_penalty_weight: float = 50.0,
        dropped_session_penalty: float = 25.0,
        session_completion_reward: float = 2.0,
        stranded_session_penalty_weight: float = 100.0,
        sla_termination_penalty: float = 1000.0,
        enable_session_migration: bool = True,
        overprovision_penalty_weight: float = 200.0,
        idle_provision_penalty_weight: float = 12.0,
        throughput_waste_penalty_weight: float = 1.5,
        efficiency_bonus_weight: float = 0.75,
        efficiency_headroom_max: float = 1.05,
        cheapest_dc_routing: bool = True,
        # Optional external electricity price control: step index -> cost per
        # kW for each datacenter. Overrides the built-in sine wave when set.
        cost_schedule: Callable[[int], Sequence[float]] | None = None,
        # Optional deterministic reset state (used by the Streamlit visualizer).
        initial_capacity_fraction: tuple[float, float] | None = None,
        initial_sessions_per_dc: tuple[int, int] | None = None,
        initial_session_duration: int | None = None,
        obs_features_per_dc: int = OBS_FEATURES_PER_DC,
        render_mode: str | None = None,
    ):
        super().__init__()
        if obs_features_per_dc not in SUPPORTED_OBS_FEATURES_PER_DC:
            raise ValueError(
                f"obs_features_per_dc must be one of {SUPPORTED_OBS_FEATURES_PER_DC}, "
                f"got {obs_features_per_dc}"
            )
        self.max_episode_steps = max_episode_steps
        self.session_count_scale = session_count_scale
        self.obs_features_per_dc = obs_features_per_dc
        if len(max_capacity) != NUM_DATACENTERS:
            raise ValueError(
                f"max_capacity must have {NUM_DATACENTERS} values, got {len(max_capacity)}"
            )
        self.max_capacity = tuple(max_capacity)
        if arrival_mode not in ARRIVAL_MODES:
            raise ValueError(
                f"arrival_mode must be one of {ARRIVAL_MODES}, got {arrival_mode!r}"
            )
        self.arrival_rate = arrival_rate
        self.arrival_mode = arrival_mode
        low, high = initial_sessions_range
        if low < 0 or high < low:
            raise ValueError(
                f"initial_sessions_range must satisfy 0 <= low <= high, got {initial_sessions_range}"
            )
        self.initial_sessions_range = initial_sessions_range
        self.min_tps = min_tps
        self.session_duration_range = session_duration_range
        self.base_cost_per_kw = base_cost_per_kw
        self.idle_energy_kw = idle_energy_kw
        self.throughput_energy_kw = throughput_energy_kw
        self.max_sla_violations = max_sla_violations
        if capacity_action_mode not in CAPACITY_ACTION_MODES:
            raise ValueError(
                f"capacity_action_mode must be one of {CAPACITY_ACTION_MODES}, "
                f"got {capacity_action_mode!r}"
            )
        if delivery_headroom_cap < 1.0:
            raise ValueError(
                f"delivery_headroom_cap must be >= 1.0, got {delivery_headroom_cap}"
            )
        if capacity_headroom_margin <= 0.0:
            raise ValueError(
                "capacity_headroom_margin must be positive, "
                f"got {capacity_headroom_margin}"
            )
        self.delivery_headroom_cap = delivery_headroom_cap
        self.capacity_action_mode = capacity_action_mode
        self.capacity_headroom_margin = capacity_headroom_margin
        self.overprovision_buffer = overprovision_buffer
        self.energy_cost_scale = energy_cost_scale
        self.sla_penalty_weight = sla_penalty_weight
        self.dropped_session_penalty = dropped_session_penalty
        self.session_completion_reward = session_completion_reward
        self.stranded_session_penalty_weight = stranded_session_penalty_weight
        self.sla_termination_penalty = sla_termination_penalty
        self.enable_session_migration = enable_session_migration
        self.overprovision_penalty_weight = overprovision_penalty_weight
        self.idle_provision_penalty_weight = idle_provision_penalty_weight
        self.throughput_waste_penalty_weight = throughput_waste_penalty_weight
        self.efficiency_bonus_weight = efficiency_bonus_weight
        self.efficiency_headroom_max = efficiency_headroom_max
        self.cheapest_dc_routing = cheapest_dc_routing
        self.cost_schedule = cost_schedule
        if initial_capacity_fraction is not None:
            if len(initial_capacity_fraction) != NUM_DATACENTERS:
                raise ValueError(
                    "initial_capacity_fraction must have "
                    f"{NUM_DATACENTERS} values, got {len(initial_capacity_fraction)}"
                )
            for fraction in initial_capacity_fraction:
                if not 0.0 <= fraction <= 1.0:
                    raise ValueError(
                        "initial_capacity_fraction values must be in [0, 1], "
                        f"got {fraction}"
                    )
        if initial_sessions_per_dc is not None:
            if len(initial_sessions_per_dc) != NUM_DATACENTERS:
                raise ValueError(
                    "initial_sessions_per_dc must have "
                    f"{NUM_DATACENTERS} values, got {len(initial_sessions_per_dc)}"
                )
            if any(count < 0 for count in initial_sessions_per_dc):
                raise ValueError(
                    f"initial_sessions_per_dc must be non-negative, "
                    f"got {initial_sessions_per_dc}"
                )
        if initial_session_duration is not None and initial_session_duration <= 0:
            raise ValueError(
                "initial_session_duration must be positive, "
                f"got {initial_session_duration}"
            )
        self.initial_capacity_fraction = initial_capacity_fraction
        self.initial_sessions_per_dc = initial_sessions_per_dc
        self.initial_session_duration = initial_session_duration
        self.render_mode = render_mode

        obs_dim = NUM_DATACENTERS * obs_features_per_dc
        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(obs_dim,), dtype=np.float32
        )
        self.action_space = spaces.Box(
            low=0.0, high=1.0, shape=(NUM_DATACENTERS,), dtype=np.float32
        )

        self._rng = np.random.default_rng()
        self._step_count = 0
        self._sla_violations = 0
        self._dropped_sessions = 0
        self._completed_sessions = 0
        self._migrated_sessions = 0
        self._arrivals_this_step = [0] * NUM_DATACENTERS
        self._dropped_this_step = 0
        self._datacenters: list[DataCenter] = []

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)

        self._step_count = 0
        self._sla_violations = 0
        self._dropped_sessions = 0
        self._completed_sessions = 0
        self._migrated_sessions = 0
        self._arrivals_this_step = [0] * NUM_DATACENTERS
        self._dropped_this_step = 0
        initial_costs = self._scheduled_costs(0)
        self._datacenters = []
        for index, max_cap in enumerate(self.max_capacity):
            self._datacenters.append(
                DataCenter(
                    capacity=0.0,
                    max_capacity=max_cap,
                    cost_per_kw=(
                        initial_costs[index]
                        if initial_costs is not None
                        else float(self._rng.uniform(*self.base_cost_per_kw))
                    ),
                )
            )

        for index, dc in enumerate(self._datacenters):
            if self.initial_sessions_per_dc is not None:
                initial_sessions = self.initial_sessions_per_dc[index]
            else:
                low, high = self.initial_sessions_range
                initial_sessions = int(self._rng.integers(low, high + 1))
            for _ in range(initial_sessions):
                if self.initial_session_duration is not None:
                    dc.sessions.append(
                        LLMSession(
                            min_tps=self.min_tps,
                            remaining_steps=self.initial_session_duration,
                        )
                    )
                else:
                    dc.sessions.append(self._sample_session())

        for index, dc in enumerate(self._datacenters):
            if self.initial_capacity_fraction is not None:
                dc.capacity = float(
                    self.initial_capacity_fraction[index] * dc.max_capacity
                )
            elif self.capacity_action_mode == "headroom":
                if dc.active_sessions > 0:
                    headroom_action = float(self._rng.uniform(0.0, 0.5))
                    dc.capacity = self._capacity_from_action(dc, headroom_action)
                else:
                    dc.capacity = 0.0
            else:
                cap_fraction = float(self._rng.uniform(0.35, 0.55))
                dc.capacity = float(cap_fraction * dc.max_capacity)

        self._update_throughput_and_energy()
        return self._get_obs(), self._get_info()

    def step(
        self, action: np.ndarray
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        action = np.asarray(action, dtype=np.float32)
        if not self.action_space.contains(action):
            raise ValueError(f"Invalid action {action}")

        self._arrivals_this_step = [0] * NUM_DATACENTERS
        self._dropped_this_step = 0

        for dc, action_value in zip(self._datacenters, action):
            dc.capacity = self._capacity_from_action(dc, float(action_value))

        if self.enable_session_migration:
            self._migrated_sessions += self._migrate_stranded_sessions()

        self._update_throughput_and_energy()
        self._vary_cost_per_kw()

        reward = -self._energy_cost() / self.energy_cost_scale
        reward += self._apply_sla_penalties()
        reward += self._apply_stranded_session_penalties()
        reward += self._apply_overprovisioning_penalties()
        reward += self._apply_throughput_waste_penalties()
        reward += self._apply_efficiency_bonus()

        reward += self._process_arrivals()

        reward += self._advance_sessions()

        self._update_throughput_and_energy()

        self._step_count += 1
        terminated = self._sla_violations >= self.max_sla_violations
        truncated = self._step_count >= self.max_episode_steps

        if terminated:
            reward -= self.sla_termination_penalty

        if self.render_mode in ("human", "ansi"):
            self.render()

        return self._get_obs(), reward, terminated, truncated, self._get_info()

    def _sample_session(self) -> LLMSession:
        duration = int(self._rng.integers(*self.session_duration_range))
        return LLMSession(min_tps=self.min_tps, remaining_steps=duration)

    def _capacity_from_action(self, dc: DataCenter, action_value: float) -> float:
        action_value = float(np.clip(action_value, 0.0, 1.0))
        if self.capacity_action_mode == "fraction":
            return action_value * dc.max_capacity

        if dc.active_sessions == 0:
            return action_value * dc.max_capacity

        target = dc.active_sessions * self.min_tps * (
            1.0 + self.capacity_headroom_margin * action_value
        )
        return float(np.clip(target, 0.0, dc.max_capacity))

    def _update_throughput_and_energy(self) -> None:
        delivery_cap = self.min_tps * self.delivery_headroom_cap
        for dc in self._datacenters:
            if not dc.sessions:
                dc.energy = self.idle_energy_kw * (dc.capacity / dc.max_capacity)
                continue

            fair_share = dc.capacity / len(dc.sessions)
            for session in dc.sessions:
                session.current_tps = min(fair_share, delivery_cap)

            capacity_fraction = dc.capacity / dc.max_capacity
            throughput_fraction = dc.accumulated_tps / dc.max_capacity
            dc.energy = (
                self.idle_energy_kw * capacity_fraction
                + self.throughput_energy_kw * throughput_fraction * dc.max_capacity
            )

    def _scheduled_costs(self, step: int) -> list[float] | None:
        """Costs from the external schedule, clipped to base_cost_per_kw."""
        if self.cost_schedule is None:
            return None
        costs = self.cost_schedule(step)
        if len(costs) != NUM_DATACENTERS:
            raise ValueError(
                f"cost_schedule must return {NUM_DATACENTERS} values, got {len(costs)}"
            )
        return [float(np.clip(cost, *self.base_cost_per_kw)) for cost in costs]

    def _vary_cost_per_kw(self) -> None:
        scheduled = self._scheduled_costs(self._step_count)
        if scheduled is not None:
            for dc, cost in zip(self._datacenters, scheduled):
                dc.cost_per_kw = cost
            return
        for index, dc in enumerate(self._datacenters):
            base = sum(self.base_cost_per_kw) / 2.0
            offset = (index - 0.5) * 0.04
            wave = 0.02 * math.sin((self._step_count + index * 7) / 15.0)
            dc.cost_per_kw = float(
                np.clip(base + offset + wave, *self.base_cost_per_kw)
            )

    def _energy_cost(self) -> float:
        return sum(dc.energy * dc.cost_per_kw for dc in self._datacenters)

    def _apply_sla_penalties(self) -> float:
        penalty = 0.0
        violating = False
        for dc in self._datacenters:
            for session in dc.sessions:
                if session.current_tps < session.min_tps:
                    violating = True
                    shortfall = (session.min_tps - session.current_tps) / session.min_tps
                    penalty -= self.sla_penalty_weight * shortfall
        if violating:
            self._sla_violations += 1
        return penalty

    def _minimum_required_capacity(self, dc: DataCenter) -> float:
        return dc.active_sessions * self.min_tps

    def _max_sessions_at_sla(self, dc: DataCenter) -> int:
        """Hardware session ceiling: max concurrent sessions at min_tps."""
        return int(dc.max_capacity / self.min_tps)

    def _available_session_slots(self, dc: DataCenter) -> int:
        """How many more sessions fit under the hardware SLA session limit."""
        if dc.capacity <= 0:
            return 0
        return max(0, self._max_sessions_at_sla(dc) - dc.active_sessions)

    def _migrate_stranded_sessions(self) -> int:
        """Move sessions off zero-capacity datacenters when spare SLA capacity exists."""
        migrated = 0
        for source_idx, source in enumerate(self._datacenters):
            if source.capacity > 0 or not source.sessions:
                continue

            pending = source.sessions
            source.sessions = []
            while pending:
                options: list[tuple[int, int, float]] = []
                for target_idx, target in enumerate(self._datacenters):
                    if target_idx == source_idx:
                        continue
                    slots = self._available_session_slots(target)
                    if slots > 0:
                        options.append((target_idx, slots, target.cost_per_kw))

                if not options:
                    source.sessions.extend(pending)
                    break

                options.sort(key=lambda item: (item[2], -item[1]))
                target_idx, slots, _ = options[0]
                target = self._datacenters[target_idx]
                move_count = min(len(pending), slots)
                target.sessions.extend(pending[:move_count])
                pending = pending[move_count:]
                migrated += move_count

        return migrated

    def _apply_stranded_session_penalties(self) -> float:
        """Penalize each session on a datacenter with zero provisioned capacity."""
        penalty = 0.0
        for dc in self._datacenters:
            if dc.active_sessions > 0 and dc.capacity <= 0:
                penalty -= self.stranded_session_penalty_weight * dc.active_sessions
        return penalty

    def _sample_arrival_count(self) -> int:
        if self.arrival_mode == "bernoulli":
            return 1 if self._rng.random() < self.arrival_rate else 0
        return int(self._rng.poisson(self.arrival_rate))

    def _process_arrivals(self) -> float:
        reward = 0.0
        for _ in range(self._sample_arrival_count()):
            reward += self._route_new_session()
        return reward

    @property
    def combined_max_sessions_at_sla(self) -> int:
        return int(sum(self.max_capacity) / self.min_tps)

    def count_stranded_sessions(self) -> int:
        return sum(
            dc.active_sessions
            for dc in self._datacenters
            if dc.active_sessions > 0 and dc.capacity <= 0
        )

    def _apply_overprovisioning_penalties(self) -> float:
        """Penalize capacity above the SLA floor or provisioned idle capacity."""
        penalty = 0.0
        for dc in self._datacenters:
            if dc.active_sessions == 0:
                if dc.capacity > 0:
                    penalty -= self.idle_provision_penalty_weight * (
                        dc.capacity / dc.max_capacity
                    )
                continue

            min_required = self._minimum_required_capacity(dc)
            buffered_required = min_required * self.overprovision_buffer
            if dc.capacity > buffered_required:
                excess_fraction = (dc.capacity - buffered_required) / dc.max_capacity
                penalty -= self.overprovision_penalty_weight * excess_fraction
                penalty -= self.overprovision_penalty_weight * (excess_fraction**2)
        return penalty

    def _apply_throughput_waste_penalties(self) -> float:
        """Penalize per-session throughput above the SLA floor (wasted tokens/sec)."""
        penalty = 0.0
        for dc in self._datacenters:
            for session in dc.sessions:
                if session.current_tps <= session.min_tps:
                    continue
                excess_fraction = (session.current_tps - session.min_tps) / session.min_tps
                penalty -= self.throughput_waste_penalty_weight * excess_fraction
        return penalty

    def _apply_efficiency_bonus(self) -> float:
        """Reward sessions running just above the minimum TPS floor."""
        bonus = 0.0
        margin = self.efficiency_headroom_max - 1.0
        if margin <= 0:
            return bonus

        for dc in self._datacenters:
            for session in dc.sessions:
                if session.current_tps < session.min_tps:
                    continue
                headroom = session.current_tps / session.min_tps
                if headroom <= self.efficiency_headroom_max:
                    closeness = 1.0 - (headroom - 1.0) / margin
                    bonus += self.efficiency_bonus_weight * max(0.0, closeness)
        return bonus

    def _choose_routing_datacenter(self, candidates: list[int]) -> int:
        if self.cheapest_dc_routing:
            # Fill cheapest DC until max_capacity / min_tps, then spill over.
            with_room = [
                index
                for index in candidates
                if self._available_session_slots(self._datacenters[index]) > 0
            ]
            pool = with_room if with_room else candidates
            return min(
                pool,
                key=lambda index: (
                    self._datacenters[index].cost_per_kw,
                    self._datacenters[index].load_ratio(),
                ),
            )

        loads = [self._datacenters[index].load_ratio() for index in candidates]
        return candidates[int(np.argmin(loads))]

    def _route_new_session(self) -> float:
        candidates = [
            index
            for index, dc in enumerate(self._datacenters)
            if dc.capacity > 0
        ]
        if not candidates:
            self._dropped_sessions += 1
            self._dropped_this_step += 1
            return -self.dropped_session_penalty

        chosen = self._choose_routing_datacenter(candidates)
        self._datacenters[chosen].sessions.append(self._sample_session())
        self._arrivals_this_step[chosen] += 1
        return 0.0

    def _advance_sessions(self) -> float:
        reward = 0.0
        for dc in self._datacenters:
            still_active: list[LLMSession] = []
            for session in dc.sessions:
                session.remaining_steps -= 1
                if session.remaining_steps <= 0:
                    self._completed_sessions += 1
                    reward += self.session_completion_reward
                else:
                    still_active.append(session)
            dc.sessions = still_active
        return reward

    def _normalize_capacity(self, capacity: float, max_capacity: float) -> float:
        return float(np.clip(capacity / max_capacity, 0.0, 1.0))

    def _normalize_tps(self, tps: float, max_capacity: float) -> float:
        return float(np.clip(tps / max_capacity, 0.0, 1.0))

    def _normalize_energy(self, energy: float, max_capacity: float) -> float:
        max_energy = self.idle_energy_kw + self.throughput_energy_kw * max_capacity
        return float(np.clip(energy / max_energy, 0.0, 1.0))

    def _normalize_cost(self, cost_per_kw: float) -> float:
        low, high = self.base_cost_per_kw
        return float(np.clip((cost_per_kw - low) / max(high - low, 1e-6), 0.0, 1.0))

    def _normalize_session_count(self, session_count: int) -> float:
        return float(
            np.clip(session_count / self.session_count_scale, 0.0, 1.0)
        )

    def _normalize_sla_pressure(self, dc: DataCenter) -> float:
        if dc.active_sessions == 0:
            return 0.0
        if dc.capacity <= 0:
            return 1.0
        pressure = dc.active_sessions * self.min_tps / dc.capacity
        return float(np.clip(pressure / 2.0, 0.0, 1.0))

    def _normalize_sla_headroom(self, dc: DataCenter) -> float:
        if dc.active_sessions == 0:
            return 1.0
        mean_delivered_tps = dc.accumulated_tps / dc.active_sessions
        return float(np.clip(mean_delivered_tps / self.min_tps, 0.0, 1.0))

    def _normalize_required_capacity(self, dc: DataCenter) -> float:
        return float(
            np.clip(dc.active_sessions * self.min_tps / dc.max_capacity, 0.0, 1.0)
        )

    def _normalize_capacity_excess(self, dc: DataCenter) -> float:
        if dc.active_sessions == 0:
            return float(np.clip(dc.capacity / dc.max_capacity, 0.0, 1.0))
        required = dc.active_sessions * self.min_tps
        if required <= 0:
            return 0.0
        excess_ratio = (dc.capacity / required) - 1.0
        return float(
            np.clip(excess_ratio / self.capacity_headroom_margin, 0.0, 1.0)
        )

    def _normalize_mean_remaining_steps(self, dc: DataCenter) -> float:
        if dc.active_sessions == 0:
            return 0.0
        mean_remaining = sum(
            session.remaining_steps for session in dc.sessions
        ) / dc.active_sessions
        max_duration = self.session_duration_range[1]
        return float(np.clip(mean_remaining / max_duration, 0.0, 1.0))

    def _datacenter_observation(self, dc: DataCenter) -> list[float]:
        features = [
            self._normalize_capacity(dc.capacity, dc.max_capacity),
            self._normalize_energy(dc.energy, dc.max_capacity),
            self._normalize_cost(dc.cost_per_kw),
            self._normalize_session_count(dc.active_sessions),
            self._normalize_tps(dc.accumulated_tps, dc.max_capacity),
            self._normalize_sla_pressure(dc),
            self._normalize_sla_headroom(dc),
            self._normalize_mean_remaining_steps(dc),
        ]
        if self.obs_features_per_dc >= 10:
            features.extend(
                [
                    self._normalize_required_capacity(dc),
                    self._normalize_capacity_excess(dc),
                ]
            )
        return features

    def _get_obs(self) -> np.ndarray:
        values: list[float] = []
        for dc in self._datacenters:
            values.extend(self._datacenter_observation(dc))
        return np.array(values, dtype=np.float32)

    def _mean_capacity_headroom(self, dc: DataCenter) -> float:
        if dc.active_sessions == 0:
            return 0.0
        required = dc.active_sessions * self.min_tps
        if required <= 0:
            return 0.0
        return dc.capacity / required

    def _mean_per_session_tps_ratio(self, dc: DataCenter) -> float:
        if dc.active_sessions == 0:
            return 0.0
        return (dc.accumulated_tps / dc.active_sessions) / self.min_tps

    def _datacenter_info(self, index: int, dc: DataCenter) -> dict[str, Any]:
        return {
            "capacity": dc.capacity,
            "max_capacity": dc.max_capacity,
            "energy": dc.energy,
            "cost_per_kw": dc.cost_per_kw,
            "active_sessions": dc.active_sessions,
            "accumulated_tps": dc.accumulated_tps,
            "load_ratio": dc.load_ratio(),
            "sla_pressure": self._normalize_sla_pressure(dc),
            "sla_headroom": self._normalize_sla_headroom(dc),
            "required_capacity": dc.active_sessions * self.min_tps,
            "max_sessions_at_sla": self._max_sessions_at_sla(dc),
            "available_session_slots": self._available_session_slots(dc),
            "capacity_headroom": self._mean_capacity_headroom(dc),
            "mean_tps_ratio": self._mean_per_session_tps_ratio(dc),
            "mean_remaining_steps": (
                0.0
                if dc.active_sessions == 0
                else sum(session.remaining_steps for session in dc.sessions)
                / dc.active_sessions
            ),
            "sessions": [
                {
                    "min_tps": session.min_tps,
                    "current_tps": session.current_tps,
                    "remaining_steps": session.remaining_steps,
                }
                for session in dc.sessions
            ],
        }

    def _get_info(self) -> dict[str, Any]:
        return {
            "step": self._step_count,
            "datacenters": [
                self._datacenter_info(index, dc)
                for index, dc in enumerate(self._datacenters)
            ],
            "arrivals_this_step": list(self._arrivals_this_step),
            "dropped_this_step": self._dropped_this_step,
            "completed_sessions": self._completed_sessions,
            "dropped_sessions": self._dropped_sessions,
            "sla_violations": self._sla_violations,
            "stranded_sessions": self.count_stranded_sessions(),
            "migrated_sessions": self._migrated_sessions,
            "total_active_sessions": sum(dc.active_sessions for dc in self._datacenters),
            "arrival_rate": self.arrival_rate,
            "arrival_mode": self.arrival_mode,
        }

    def render(self) -> str | None:
        lines = [f"step={self._step_count}"]
        for index, dc in enumerate(self._datacenters):
            lines.append(
                f"dc{index}: capacity={dc.capacity:.1f}/{dc.max_capacity:.1f} tps  "
                f"energy={dc.energy:.2f} kW  "
                f"cost={dc.cost_per_kw:.3f} $/kW  "
                f"sessions={dc.active_sessions}  "
                f"accum_tps={dc.accumulated_tps:.1f}  "
                f"load={dc.load_ratio():.4f}"
            )
            for session_index, session in enumerate(dc.sessions):
                lines.append(
                    f"  session {session_index}: "
                    f"min_tps={session.min_tps:.1f}  "
                    f"current_tps={session.current_tps:.1f}"
                )
        lines.append(
            f"completed={self._completed_sessions}  "
            f"dropped={self._dropped_sessions}  "
            f"sla_violations={self._sla_violations}"
        )
        text = "\n".join(lines)
        if self.render_mode == "human":
            print(text)
        return text

    def close(self) -> None:
        return None


def make_env(
    *,
    max_episode_steps: int = DEFAULT_MAX_EPISODE_STEPS,
    render_mode: str | None = None,
    **kwargs: Any,
) -> gym.Env:
    """Build the edge data center environment."""
    return EdgeDataCenterEnv(
        max_episode_steps=max_episode_steps,
        render_mode=render_mode,
        **kwargs,
    )


gym.register(
    id=ENV_ID,
    entry_point="edge_datacenter_env:EdgeDataCenterEnv",
    max_episode_steps=DEFAULT_MAX_EPISODE_STEPS,
)
