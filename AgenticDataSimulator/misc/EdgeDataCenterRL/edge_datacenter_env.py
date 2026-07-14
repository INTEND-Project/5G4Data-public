"""Edge data center LLM session scheduling environment for Gymnasium."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

ENV_ID = "EdgeDataCenter-v0"
DEFAULT_MAX_EPISODE_STEPS = 200
NUM_DATACENTERS = 2
OBS_FEATURES_PER_DC = 8


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
    sessions to the datacenter with the lowest load (active sessions /
    capacity). The agent sets each datacenter's capacity to minimize energy
    cost while meeting per-session minimum TPS requirements.
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
        # Every step has a probability of a new session arriving (e.g. 0.40 means 40% chance per step)
        arrival_rate: float = 0.40,
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
        render_mode: str | None = None,
    ):
        super().__init__()
        self.max_episode_steps = max_episode_steps
        self.session_count_scale = session_count_scale
        if len(max_capacity) != NUM_DATACENTERS:
            raise ValueError(
                f"max_capacity must have {NUM_DATACENTERS} values, got {len(max_capacity)}"
            )
        self.max_capacity = tuple(max_capacity)
        self.arrival_rate = arrival_rate
        self.min_tps = min_tps
        self.session_duration_range = session_duration_range
        self.base_cost_per_kw = base_cost_per_kw
        self.idle_energy_kw = idle_energy_kw
        self.throughput_energy_kw = throughput_energy_kw
        self.max_sla_violations = max_sla_violations
        self.render_mode = render_mode

        obs_dim = NUM_DATACENTERS * OBS_FEATURES_PER_DC
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
        self._datacenters = [
            DataCenter(
                capacity=float(self._rng.uniform(0.35, 0.55) * max_cap),
                max_capacity=max_cap,
                cost_per_kw=float(
                    self._rng.uniform(*self.base_cost_per_kw)
                ),
            )
            for max_cap in self.max_capacity
        ]

        for dc in self._datacenters:
            initial_sessions = int(self._rng.integers(1, 4))
            for _ in range(initial_sessions):
                dc.sessions.append(self._sample_session())

        self._update_throughput_and_energy()
        return self._get_obs(), self._get_info()

    def step(
        self, action: np.ndarray
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        action = np.asarray(action, dtype=np.float32)
        if not self.action_space.contains(action):
            raise ValueError(f"Invalid action {action}")

        for dc, target_fraction in zip(self._datacenters, action):
            dc.capacity = float(
                np.clip(target_fraction, 0.0, 1.0) * dc.max_capacity
            )

        self._update_throughput_and_energy()
        self._vary_cost_per_kw()

        reward = -self._energy_cost()
        reward += self._apply_sla_penalties()

        # Bernoulli distribution of new session arrivals (if self._rng.random() < self.arrival_rate)
        # and how it is load balanced (_route_new_session()), thus modelling the external load balancer
        if self._rng.random() < self.arrival_rate:
            reward += self._route_new_session()

        reward += self._advance_sessions()

        self._update_throughput_and_energy()

        self._step_count += 1
        terminated = self._sla_violations >= self.max_sla_violations
        truncated = self._step_count >= self.max_episode_steps

        if self.render_mode in ("human", "ansi"):
            self.render()

        return self._get_obs(), reward, terminated, truncated, self._get_info()

    def _sample_session(self) -> LLMSession:
        duration = int(self._rng.integers(*self.session_duration_range))
        return LLMSession(min_tps=self.min_tps, remaining_steps=duration)

    def _update_throughput_and_energy(self) -> None:
        for dc in self._datacenters:
            if not dc.sessions:
                dc.energy = self.idle_energy_kw * (dc.capacity / dc.max_capacity)
                continue

            fair_share = dc.capacity / len(dc.sessions)
            for session in dc.sessions:
                session.current_tps = fair_share

            capacity_fraction = dc.capacity / dc.max_capacity
            throughput_fraction = dc.accumulated_tps / dc.max_capacity
            dc.energy = (
                self.idle_energy_kw * capacity_fraction
                + self.throughput_energy_kw * throughput_fraction * dc.max_capacity
            )

    def _vary_cost_per_kw(self) -> None:
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
                    penalty -= 1.5 * shortfall
        if violating:
            self._sla_violations += 1
        return penalty

    def _route_new_session(self) -> float:
        candidates = [
            index
            for index, dc in enumerate(self._datacenters)
            if dc.capacity > 0
        ]
        if not candidates:
            self._dropped_sessions += 1
            return -2.0

        loads = [self._datacenters[index].load_ratio() for index in candidates]
        chosen = candidates[int(np.argmin(loads))]
        self._datacenters[chosen].sessions.append(self._sample_session())
        return 0.0

    def _advance_sessions(self) -> float:
        reward = 0.0
        for dc in self._datacenters:
            still_active: list[LLMSession] = []
            for session in dc.sessions:
                session.remaining_steps -= 1
                if session.remaining_steps <= 0:
                    self._completed_sessions += 1
                    reward += 0.5
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
        per_session_tps = dc.capacity / dc.active_sessions
        return float(np.clip(per_session_tps / self.min_tps, 0.0, 1.0))

    def _normalize_mean_remaining_steps(self, dc: DataCenter) -> float:
        if dc.active_sessions == 0:
            return 0.0
        mean_remaining = sum(
            session.remaining_steps for session in dc.sessions
        ) / dc.active_sessions
        max_duration = self.session_duration_range[1]
        return float(np.clip(mean_remaining / max_duration, 0.0, 1.0))

    def _datacenter_observation(self, dc: DataCenter) -> list[float]:
        return [
            self._normalize_capacity(dc.capacity, dc.max_capacity),
            self._normalize_energy(dc.energy, dc.max_capacity),
            self._normalize_cost(dc.cost_per_kw),
            self._normalize_session_count(dc.active_sessions),
            self._normalize_tps(dc.accumulated_tps, dc.max_capacity),
            self._normalize_sla_pressure(dc),
            self._normalize_sla_headroom(dc),
            self._normalize_mean_remaining_steps(dc),
        ]

    def _get_obs(self) -> np.ndarray:
        values: list[float] = []
        for dc in self._datacenters:
            values.extend(self._datacenter_observation(dc))
        return np.array(values, dtype=np.float32)

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
            "completed_sessions": self._completed_sessions,
            "dropped_sessions": self._dropped_sessions,
            "sla_violations": self._sla_violations,
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
) -> gym.Env:
    """Build the edge data center environment."""
    return EdgeDataCenterEnv(
        max_episode_steps=max_episode_steps,
        render_mode=render_mode,
    )


gym.register(
    id=ENV_ID,
    entry_point="edge_datacenter_env:EdgeDataCenterEnv",
    max_episode_steps=DEFAULT_MAX_EPISODE_STEPS,
)
