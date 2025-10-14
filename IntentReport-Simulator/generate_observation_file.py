#!/usr/bin/env python3
"""
Generate a CSV file containing timestamp/value observations for a single metric.

The CSV will contain a header row (`timestamp,<metric-name>`) and subsequent rows with
ISO8601 timestamps (UTC, suffixed with 'Z') and random values drawn uniformly
from the provided range.

Inputs:
- start_time: ISO8601 timestamp (e.g., 2025-10-07T00:00:00Z)
- end_time: ISO8601 timestamp (e.g., 2025-10-07T01:00:00Z)
- frequency: Sampling interval. Supported formats: integer seconds (e.g., 60) or
             value+unit (e.g., 15s, 5m, 1h). Units: s = seconds, m = minutes, h = hours.
- value range: min_value and max_value
- output: Output CSV file path (optional; if omitted a descriptive name is generated)
- metric_name (optional): Column name for the value column; defaults to "value"

Example:
  python generate_observation_file.py \
    --start-time 2025-10-07T00:00:00Z \
    --end-time 2025-10-07T02:00:00Z \
    --frequency 5m \
    --min 10 --max 100 \
    --metric-name bandwidth_mbps \
    --output bandwidth.csv
"""

from __future__ import annotations

import argparse
import csv
import random
from datetime import datetime, timedelta, timezone
from typing import Optional


def parse_iso8601(dt_str: str) -> datetime:
    """Parse an ISO8601 timestamp to a timezone-aware datetime (UTC).

    Accepts 'Z' suffix or explicit timezone offsets. If no timezone is provided,
    the timestamp is interpreted as UTC.
    """
    # Normalize 'Z' to '+00:00' for fromisoformat
    normalized = dt_str.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Invalid ISO8601 datetime: {dt_str}. Example: 2025-10-07T00:00:00Z"
        ) from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_frequency(freq_str: str) -> timedelta:
    """Parse frequency string to timedelta.

    Supports:
      - integer seconds (e.g., "60")
      - suffixed with unit: "Xs", "Xm", "Xh" (e.g., "15s", "5m", "1h")
    """
    text = freq_str.strip().lower()
    # If it's a plain integer, interpret as seconds
    if text.isdigit():
        seconds = int(text)
        if seconds <= 0:
            raise argparse.ArgumentTypeError("frequency must be > 0 seconds")
        return timedelta(seconds=seconds)

    if text.endswith("s") and text[:-1].isdigit():
        value = int(text[:-1])
        if value <= 0:
            raise argparse.ArgumentTypeError("frequency must be > 0 seconds")
        return timedelta(seconds=value)
    if text.endswith("m") and text[:-1].isdigit():
        value = int(text[:-1])
        if value <= 0:
            raise argparse.ArgumentTypeError("frequency must be > 0 minutes")
        return timedelta(minutes=value)
    if text.endswith("h") and text[:-1].isdigit():
        value = int(text[:-1])
        if value <= 0:
            raise argparse.ArgumentTypeError("frequency must be > 0 hours")
        return timedelta(hours=value)

    raise argparse.ArgumentTypeError(
        "Unsupported frequency format. Use integer seconds or one of: 15s, 5m, 1h"
    )


def format_timestamp_iso8601_utc(dt: datetime) -> str:
    """Format a timezone-aware datetime as ISO8601 UTC string with 'Z' suffix."""
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def format_timestamp_compact_utc(dt: datetime) -> str:
    """Format datetime to a filesystem-friendly UTC string: YYYYMMDDTHHMMSSZ."""
    dt_utc = dt.astimezone(timezone.utc)
    return dt_utc.strftime("%Y%m%dT%H%M%SZ")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def generate_values_random(
    start: datetime,
    end: datetime,
    step: timedelta,
    min_value: float,
    max_value: float,
):
    """Uniform random values within [min_value, max_value]."""
    current = start
    while current <= end:
        yield current, random.uniform(min_value, max_value)
        current = current + step


def generate_values_diurnal(
    start: datetime,
    end: datetime,
    step: timedelta,
    min_value: float,
    max_value: float,
):
    """Daily sinusoidal baseline with small Gaussian noise; clamped to range.

    Peak around mid-day; leaves headroom for noise by using < full amplitude.
    """
    current = start
    value_range = max_value - min_value
    midpoint = (min_value + max_value) / 2.0
    amplitude = (value_range / 2.0) * 0.85  # 85% of half-range to avoid frequent clipping
    noise_sigma = value_range * 0.05       # 5% of range
    while current <= end:
        # Fraction of day in UTC
        day_seconds = (current - current.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds()
        frac_of_day = day_seconds / 86400.0
        # phase shift to have minimum near ~3am and maximum late afternoon
        from math import sin, tau
        baseline = midpoint + amplitude * sin(tau * (frac_of_day - 0.25))
        noisy = baseline + random.gauss(0.0, noise_sigma)
        yield current, clamp(noisy, min_value, max_value)
        current = current + step


def generate_values_walk(
    start: datetime,
    end: datetime,
    step: timedelta,
    min_value: float,
    max_value: float,
):
    """Mean-reverting random walk (Ornstein–Uhlenbeck-like), clamped to range."""
    current = start
    value_range = max_value - min_value
    midpoint = (min_value + max_value) / 2.0
    # Parameters
    theta = 0.2                           # reversion speed
    sigma = 0.1 * value_range             # volatility scale per sqrt(second)
    dt_seconds = step.total_seconds()
    sqrt_dt = dt_seconds ** 0.5
    x = midpoint  # start at midpoint
    while current <= end:
        # OU step: x += theta*(mu-x)*dt + sigma*sqrt(dt)*N(0,1)
        x = x + theta * (midpoint - x) * dt_seconds + sigma * sqrt_dt * random.gauss(0.0, 1.0)
        x = clamp(x, min_value, max_value)
        yield current, x
        current = current + step


def generate_values_trend(
    start: datetime,
    end: datetime,
    step: timedelta,
    min_value: float,
    max_value: float,
):
    """Linear trend from min to max across the interval with noise; clamped."""
    current = start
    value_range = max_value - min_value
    noise_sigma = value_range * 0.03  # 3% of range
    total_seconds = max((end - start).total_seconds(), step.total_seconds())
    while current <= end:
        elapsed = (current - start).total_seconds()
        progress = min(1.0, max(0.0, elapsed / total_seconds))
        baseline = min_value + value_range * progress
        noisy = baseline + random.gauss(0.0, noise_sigma)
        yield current, clamp(noisy, min_value, max_value)
        current = current + step


def write_csv(
    output_path: str,
    metric_name: str,
    rows,
    decimal_places: int,
    header_comments: list[str] | None = None,
):
    """Write rows of (timestamp, value) to CSV with header.

    If header_comments are provided, each string will be written as a line
    prefixed with '# ' before the CSV header.
    """
    with open(output_path, mode="w", newline="", encoding="utf-8") as fp:
        if header_comments:
            for line in header_comments:
                fp.write(f"# {line}\n")
        writer = csv.writer(fp)
        writer.writerow(["timestamp", metric_name])
        q = 10 ** decimal_places
        for dt, value in rows:
            # Round to the requested number of decimal places without altering distribution
            rounded_value = int(value * q) / q
            writer.writerow([format_timestamp_iso8601_utc(dt), f"{rounded_value:.{decimal_places}f}"])


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate CSV observations for a single metric.")
    parser.add_argument("--start-time", required=True, type=parse_iso8601, help="Start timestamp (ISO8601), e.g., 2025-10-07T00:00:00Z")
    parser.add_argument("--end-time", required=True, type=parse_iso8601, help="End timestamp (ISO8601), e.g., 2025-10-07T02:00:00Z")
    parser.add_argument("--frequency", required=True, type=parse_frequency, help="Sampling interval (seconds or 15s/5m/1h)")
    parser.add_argument("--min", dest="min_value", required=True, type=float, help="Minimum value (inclusive)")
    parser.add_argument("--max", dest="max_value", required=True, type=float, help="Maximum value (inclusive)")
    parser.add_argument("--output", required=False, default=None, help="Output CSV file path (optional)")
    parser.add_argument("--metric-name", default="value", help="Name for the value column (default: value)")
    parser.add_argument("--mode", choices=["random", "diurnal", "walk", "trend"], default="random", help="Value generation mode")
    # Anomaly configuration
    parser.add_argument("--anomaly", choices=["none", "random", "fixed", "peak"], default="none", help="Anomaly injection strategy")
    parser.add_argument("--anomaly-rate", type=float, default=0.01, help="For random/peak: probability to start an anomaly at a sample (0..1)")
    parser.add_argument("--anomaly-interval", type=parse_frequency, default=None, help="For fixed: interval between anomaly starts (e.g., 1h)")
    parser.add_argument("--anomaly-duration-samples", type=int, default=3, help="Duration of each anomaly in number of samples")
    parser.add_argument("--anomaly-amplitude-frac", type=float, default=0.3, help="Anomaly amplitude as fraction of (max-min), e.g., 0.3 = 30%")
    parser.add_argument("--anomaly-direction", choices=["spike", "dip", "both"], default="both", help="Whether anomalies go up, down, or both")
    parser.add_argument("--peak-start-hour", type=int, default=16, help="For peak: start hour inclusive in UTC (0-23)")
    parser.add_argument("--peak-end-hour", type=int, default=20, help="For peak: end hour exclusive in UTC (0-23)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility (optional)")
    parser.add_argument("--decimal-places", type=int, default=3, help="Decimal places for values (default: 3)")
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.min_value > args.max_value:
        parser.error("--min must be <= --max")
    if args.frequency <= timedelta(0):
        parser.error("--frequency must be positive")
    if args.end_time < args.start_time:
        parser.error("--end-time must be >= --start-time")
    if args.decimal_places < 0:
        parser.error("--decimal-places must be >= 0")
    if args.anomaly == "fixed" and args.anomaly_interval is None:
        parser.error("--anomaly fixed requires --anomaly-interval")
    if args.anomaly_rate < 0 or args.anomaly_rate > 1:
        parser.error("--anomaly-rate must be in [0,1]")
    if args.anomaly_duration_samples <= 0:
        parser.error("--anomaly-duration-samples must be > 0")
    if args.anomaly_amplitude_frac < 0:
        parser.error("--anomaly-amplitude-frac must be >= 0")
    if not (0 <= args.peak_start_hour <= 23 and 0 <= args.peak_end_hour <= 23):
        parser.error("--peak-start-hour and --peak-end-hour must be in 0..23")

    if args.seed is not None:
        random.seed(args.seed)

    # Select generator based on mode
    if args.mode == "random":
        rows = generate_values_random(
            start=args.start_time,
            end=args.end_time,
            step=args.frequency,
            min_value=args.min_value,
            max_value=args.max_value,
        )
    elif args.mode == "diurnal":
        rows = generate_values_diurnal(
            start=args.start_time,
            end=args.end_time,
            step=args.frequency,
            min_value=args.min_value,
            max_value=args.max_value,
        )
    elif args.mode == "walk":
        rows = generate_values_walk(
            start=args.start_time,
            end=args.end_time,
            step=args.frequency,
            min_value=args.min_value,
            max_value=args.max_value,
        )
    elif args.mode == "trend":
        rows = generate_values_trend(
            start=args.start_time,
            end=args.end_time,
            step=args.frequency,
            min_value=args.min_value,
            max_value=args.max_value,
        )
    else:
        # Should not happen due to argparse choices
        rows = generate_values_random(
            start=args.start_time,
            end=args.end_time,
            step=args.frequency,
            min_value=args.min_value,
            max_value=args.max_value,
        )

    # Apply anomalies if requested
    def with_anomalies(rows_iter):
        if args.anomaly == "none":
            for dt, v in rows_iter:
                yield dt, v
            return

        value_range = args.max_value - args.min_value
        amplitude = args.anomaly_amplitude_frac * value_range

        # State for current anomaly window
        remaining = 0  # samples left in current anomaly
        direction_sign = 1.0

        # For fixed schedule
        next_fixed_start: Optional[datetime] = None
        if args.anomaly == "fixed":
            # Align first anomaly to the first sample >= start + interval
            next_fixed_start = args.start_time
        
        for dt, base_value in rows_iter:
            start_new = False
            if remaining > 0:
                remaining -= 1
            else:
                # No active anomaly, decide if we start one
                if args.anomaly == "random":
                    start_new = random.random() < args.anomaly_rate
                elif args.anomaly == "peak":
                    hour = dt.astimezone(timezone.utc).hour
                    in_window = False
                    if args.peak_start_hour <= args.peak_end_hour:
                        in_window = args.peak_start_hour <= hour < args.peak_end_hour
                    else:
                        # window wraps midnight
                        in_window = hour >= args.peak_start_hour or hour < args.peak_end_hour
                    if in_window and (random.random() < args.anomaly_rate):
                        start_new = True
                elif args.anomaly == "fixed":
                    # Start at exact interval boundaries from start_time
                    if next_fixed_start is None:
                        next_fixed_start = args.start_time
                    while next_fixed_start <= dt:
                        if next_fixed_start == dt:
                            start_new = True
                            next_fixed_start = next_fixed_start + args.anomaly_interval
                            break
                        next_fixed_start = next_fixed_start + args.anomaly_interval

                if start_new:
                    remaining = args.anomaly_duration_samples
                    if args.anomaly_direction == "spike":
                        direction_sign = 1.0
                    elif args.anomaly_direction == "dip":
                        direction_sign = -1.0
                    else:
                        direction_sign = 1.0 if random.random() < 0.5 else -1.0

            if remaining > 0:
                # For anomalies, allow values to go outside the min/max range
                adjusted = base_value + direction_sign * amplitude
                yield dt, adjusted
            else:
                yield dt, base_value

    rows = with_anomalies(rows)

    # Determine output path if not provided
    if args.output:
        output_path = args.output
    else:
        start_compact = format_timestamp_iso8601_utc(args.start_time)
        end_compact = format_timestamp_iso8601_utc(args.end_time)
        freq_seconds = int(args.frequency.total_seconds())
        parts = [
            "observations",
            args.metric_name,
            f"Start:{start_compact}",
            f"End:{end_compact}",
            f"mode{args.mode}",
            f"freq{freq_seconds}s",
            f"min{args.min_value}",
            f"max{args.max_value}",
        ]
        if args.anomaly != "none":
            parts.append(f"anomaly{args.anomaly}")
            if args.anomaly == "random" or args.anomaly == "peak":
                parts.append(f"rate{args.anomaly_rate}")
            if args.anomaly == "fixed" and args.anomaly_interval is not None:
                parts.append(f"int{int(args.anomaly_interval.total_seconds())}s")
            parts.append(f"dur{args.anomaly_duration_samples}")
            parts.append(f"amp{args.anomaly_amplitude_frac}")
            parts.append(f"dir{args.anomaly_direction}")
        if args.seed is not None:
            parts.append(f"seed{args.seed}")
        if args.decimal_places != 3:
            parts.append(f"dp{args.decimal_places}")
        output_path = "_".join(str(p) for p in parts) + ".csv"

    # Compose header comments with configuration used
    def td_to_str(td: timedelta) -> str:
        total_seconds = int(td.total_seconds())
        if total_seconds % 3600 == 0:
            return f"{total_seconds // 3600}h"
        if total_seconds % 60 == 0:
            return f"{total_seconds // 60}m"
        return f"{total_seconds}s"

    header_comments = [
        f"generated_at={format_timestamp_iso8601_utc(datetime.now(timezone.utc))}",
        f"start_time={format_timestamp_iso8601_utc(args.start_time)}",
        f"end_time={format_timestamp_iso8601_utc(args.end_time)}",
        f"frequency={td_to_str(args.frequency)}",
        f"min={args.min_value}",
        f"max={args.max_value}",
        f"mode={args.mode}",
        f"decimal_places={args.decimal_places}",
        f"metric_name={args.metric_name}",
        f"anomaly={args.anomaly}",
    ]
    if args.anomaly in ("random", "peak"):
        header_comments.append(f"anomaly_rate={args.anomaly_rate}")
    if args.anomaly == "fixed" and args.anomaly_interval is not None:
        header_comments.append(f"anomaly_interval={td_to_str(args.anomaly_interval)}")
    header_comments.extend([
        f"anomaly_duration_samples={args.anomaly_duration_samples}",
        f"anomaly_amplitude_frac={args.anomaly_amplitude_frac}",
        f"anomaly_direction={args.anomaly_direction}",
        f"peak_start_hour={args.peak_start_hour}",
        f"peak_end_hour={args.peak_end_hour}",
    ])
    if args.seed is not None:
        header_comments.append(f"seed={args.seed}")

    write_csv(
        output_path=output_path,
        metric_name=args.metric_name,
        rows=rows,
        decimal_places=args.decimal_places,
        header_comments=header_comments,
    )

    # Print the name of the file that was created
    print(output_path)


if __name__ == "__main__":
    main()


