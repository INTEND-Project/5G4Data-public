"""Per-step value schedules for visualization runs (cost, arrival rate)."""
from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np

PATTERNS = ("fixed", "sine", "ramp up", "ramp down", "random walk")

Schedule = Callable[[int], float]


def make_schedule(
    pattern: str,
    *,
    value: float = 0.0,
    low: float = 0.0,
    high: float = 1.0,
    total_steps: int = 200,
    cycles: float = 2.0,
    seed: int | None = None,
) -> Schedule:
    """Build a step-index -> value function for the given pattern.

    - fixed: constant `value` (low/high are ignored)
    - sine: oscillates between low and high, `cycles` periods over the episode
    - ramp up / ramp down: linear low -> high / high -> low
    - random walk: seeded walk clipped to [low, high]
    """
    if pattern not in PATTERNS:
        raise ValueError(f"pattern must be one of {PATTERNS}, got {pattern!r}")
    if pattern != "fixed" and high < low:
        raise ValueError(f"high must be >= low, got low={low}, high={high}")

    span = max(total_steps - 1, 1)

    if pattern == "fixed":
        return lambda step: value

    if pattern == "sine":
        mid = (low + high) / 2.0
        amplitude = (high - low) / 2.0

        def sine(step: int) -> float:
            phase = 2.0 * math.pi * cycles * (step / span)
            return mid + amplitude * math.sin(phase)

        return sine

    if pattern == "ramp up":
        return lambda step: low + (high - low) * min(step / span, 1.0)

    if pattern == "ramp down":
        return lambda step: high - (high - low) * min(step / span, 1.0)

    # random walk: precompute so lookups are deterministic and repeatable.
    rng = np.random.default_rng(seed)
    step_size = (high - low) / 12.0
    values = np.empty(total_steps + 1)
    values[0] = rng.uniform(low, high)
    for i in range(1, total_steps + 1):
        values[i] = np.clip(values[i - 1] + rng.normal(0.0, step_size), low, high)

    return lambda step: float(values[min(step, total_steps)])


def preview(schedule: Schedule, total_steps: int) -> list[float]:
    """Sample the schedule at every step, e.g. for plotting."""
    return [schedule(step) for step in range(total_steps + 1)]
