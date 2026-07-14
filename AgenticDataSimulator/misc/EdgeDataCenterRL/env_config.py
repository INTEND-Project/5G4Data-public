"""Shared environment configuration for train/eval scripts."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any

# Combined SLA-feasible session count at 100% capacity on both DCs (defaults).
DEFAULT_MAX_CAPACITY = (200_000.0, 150_000.0)
DEFAULT_MIN_TPS = 400.0
DEFAULT_COMBINED_MAX_SESSIONS_AT_SLA = int(
    sum(DEFAULT_MAX_CAPACITY) / DEFAULT_MIN_TPS
)  # 875


def steady_state_sessions_estimate(
    arrival_rate: float,
    session_duration_range: tuple[int, int],
    *,
    arrival_mode: str = "poisson",
) -> float:
    """Rough concurrent session estimate: mean arrivals/step × mean duration."""
    mean_duration = sum(session_duration_range) / 2.0
    mean_arrivals = arrival_rate if arrival_mode == "poisson" else arrival_rate
    return mean_arrivals * mean_duration


@dataclass
class EnvConfig:
    max_episode_steps: int = 200
    session_count_scale: float = 1024.0
    arrival_rate: float = 0.40
    arrival_mode: str = "bernoulli"
    initial_sessions_range: tuple[int, int] = (1, 3)
    session_duration_range: tuple[int, int] = (20, 60)
    render_mode: str | None = None

    def to_kwargs(self) -> dict[str, Any]:
        return {
            "max_episode_steps": self.max_episode_steps,
            "session_count_scale": self.session_count_scale,
            "arrival_rate": self.arrival_rate,
            "arrival_mode": self.arrival_mode,
            "initial_sessions_range": self.initial_sessions_range,
            "session_duration_range": self.session_duration_range,
            "render_mode": self.render_mode,
        }

    @property
    def combined_max_sessions_at_sla(self) -> int:
        return DEFAULT_COMBINED_MAX_SESSIONS_AT_SLA

    def estimated_concurrent_sessions(self) -> float:
        return steady_state_sessions_estimate(
            self.arrival_rate,
            self.session_duration_range,
            arrival_mode=self.arrival_mode,
        )


@dataclass
class TrainEnvConfig(EnvConfig):
    """Defaults for high-load training with Poisson arrivals."""

    arrival_rate: float = 4.0
    arrival_mode: str = "poisson"
    initial_sessions_range: tuple[int, int] = (10, 40)
    session_count_scale: float = 1024.0

    # Curriculum targets (~875 concurrent at λ=22, mean duration 40).
    arrival_rate_start: float = 4.0
    arrival_rate_end: float = 22.0
    curriculum_enabled: bool = True


def np_clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def add_env_arguments(parser: argparse.ArgumentParser) -> None:
    group = parser.add_argument_group("environment")
    group.add_argument(
        "--arrival-rate",
        type=float,
        default=None,
        help="Arrivals per step (Bernoulli probability or Poisson mean).",
    )
    group.add_argument(
        "--arrival-mode",
        choices=ARRIVAL_MODES,
        default=None,
        help="Arrival process: bernoulli (demo default) or poisson (training).",
    )
    group.add_argument(
        "--initial-sessions-min",
        type=int,
        default=None,
        help="Minimum initial sessions per datacenter at reset.",
    )
    group.add_argument(
        "--initial-sessions-max",
        type=int,
        default=None,
        help="Maximum initial sessions per datacenter at reset (inclusive).",
    )
    group.add_argument(
        "--session-duration-min",
        type=int,
        default=None,
        help="Minimum session lifetime in steps.",
    )
    group.add_argument(
        "--session-duration-max",
        type=int,
        default=None,
        help="Maximum session lifetime in steps.",
    )
    group.add_argument(
        "--session-count-scale",
        type=float,
        default=None,
        help="Reference peak session count for observation normalization.",
    )


# Import for add_env_arguments - need ARRIVAL_MODES from edge module
ARRIVAL_MODES = ("bernoulli", "poisson")


def env_config_from_args(
    args: argparse.Namespace,
    *,
    defaults: EnvConfig,
) -> EnvConfig:
    initial_min = (
        args.initial_sessions_min
        if args.initial_sessions_min is not None
        else defaults.initial_sessions_range[0]
    )
    initial_max = (
        args.initial_sessions_max
        if args.initial_sessions_max is not None
        else defaults.initial_sessions_range[1]
    )
    duration_min = (
        args.session_duration_min
        if args.session_duration_min is not None
        else defaults.session_duration_range[0]
    )
    duration_max = (
        args.session_duration_max
        if args.session_duration_max is not None
        else defaults.session_duration_range[1]
    )
    return EnvConfig(
        max_episode_steps=args.max_episode_steps,
        session_count_scale=(
            args.session_count_scale
            if args.session_count_scale is not None
            else defaults.session_count_scale
        ),
        arrival_rate=(
            args.arrival_rate if args.arrival_rate is not None else defaults.arrival_rate
        ),
        arrival_mode=(
            args.arrival_mode if args.arrival_mode is not None else defaults.arrival_mode
        ),
        initial_sessions_range=(initial_min, initial_max),
        session_duration_range=(duration_min, duration_max),
    )

