import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import argparse
from datetime import datetime, timedelta
import matplotlib.dates as mdates
import calendar

def smooth_busy_factor(hour, busy_start, busy_end, ramp=1.5):
    """Smooth cosine transition into and out of busy periods."""
    if busy_start - ramp <= hour <= busy_start + ramp:
        return 0.5 * (1 - np.cos(np.pi * (hour - (busy_start - ramp)) / (2 * ramp)))
    elif busy_start + ramp < hour < busy_end - ramp:
        return 1.0
    elif busy_end - ramp <= hour <= busy_end + ramp:
        return 0.5 * (1 + np.cos(np.pi * (hour - (busy_end - ramp)) / (2 * ramp)))
    else:
        return 0.0

def simulate_value(ts, deviation, min_value, max_value, direction="down", daily_bias=None):
    hour = ts.hour + ts.minute / 60.0
    date = ts.date()

    # Midpoint and range
    midpoint = (min_value + max_value) / 2
    range_half = (max_value - min_value) / 2

    # Weekend adjustment
    day_of_week = calendar.weekday(ts.year, ts.month, ts.day)
    weekend_boost = 0.05 * range_half if day_of_week in [5, 6] else 0

    # Base value around midpoint
    base = midpoint + np.random.normal(0, 0.05 * range_half)

    # Busy periods
    busy1 = smooth_busy_factor(hour, 11.5, 12.5)
    busy2 = smooth_busy_factor(hour, 17.5, 22.0)
    busy_total = busy1 + busy2

    # Apply direction
    if direction == "down":
        busy_load = busy_total * (-deviation)
    elif direction == "up":
        busy_load = busy_total * deviation
    else:
        raise ValueError("Direction must be 'up' or 'down'.")

    # Daily wave
    daily_wave = 0.1 * range_half * np.sin((hour / 24.0) * 2 * np.pi)

    # Daily random bias adjustment
    bias = daily_bias.get(date, 0)

    # Final value
    value = base + busy_load + weekend_boost + daily_wave + bias

    # Add small noise
    noise = np.random.normal(0, 0.02 * range_half)
    value += noise

    return np.clip(value, min_value, max_value)

def main():
    parser = argparse.ArgumentParser(description="Simulate time-series metric data.")

    # Arguments
    parser.add_argument("--interval", type=int, required=True, help="Interval between samples in seconds.")
    parser.add_argument("--start", type=str, default=None, help="Start time (format: 'YYYY-MM-DD HH:MM:SS'). Default: now.")
    parser.add_argument("--period_days", type=int, default=7, help="Number of days to simulate. Default: 7.")
    parser.add_argument("--min", dest="min_value", type=float, required=True, help="Minimum metric value.")
    parser.add_argument("--max", dest="max_value", type=float, required=True, help="Maximum metric value.")
    parser.add_argument("--deviation", type=float, required=True, help="Deviation during busy periods.")
    parser.add_argument("--unit", type=str, required=True, help="Measurement unit (e.g., Mbps, ms, GHz).")
    parser.add_argument("--type", dest="type_of_metric", type=str, required=True, help="Metric type (e.g., bandwidth, latency, compute_latency).")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility. Optional.")
    parser.add_argument("--direction", type=str, choices=["up", "down"], default="down",
                    help="Direction of variation during busy periods: 'up' or 'down'. Default: down.")
    parser.add_argument("--output", type=str, default=None,
                    help="Optional output CSV filename. If not set, defaults to '<type>_simulated.csv'.")
    parser.add_argument("--plot", action="store_true",
                    help="If set, plot the generated data. Otherwise only CSV is created.")
    parser.add_argument("--values_only", action="store_true",
                    help="If set, only output raw values in the CSV (no headers, no timestamps, no units).")

    args = parser.parse_args()

    # Set seed
    if args.seed is not None:
        np.random.seed(args.seed)

    # Start time
    if args.start is None:
        start_time = datetime.now()
    else:
        start_time = datetime.strptime(args.start, "%Y-%m-%d %H:%M:%S")

    # Generate timestamps
    num_points = int((args.period_days * 24 * 3600) // args.interval)
    timestamps = [start_time + timedelta(seconds=i * args.interval) for i in range(num_points)]

    # Generate a small random bias per day
    dates = sorted(set(ts.date() for ts in timestamps))
    daily_bias = {date: np.random.normal(0, 0.05 * (args.max_value - args.min_value)) for date in dates}

    # Generate metric values
    values = [simulate_value(ts, args.deviation, args.min_value, args.max_value, args.direction, daily_bias) for ts in timestamps]


    # Create DataFrame
    data = pd.DataFrame({
        "unit": [args.unit] * num_points,
        "value": np.round(values, 1),
        "timestamp": timestamps
    })

    # Prepare output filename
    if args.output:
        csv_output_path = args.output
    else:
        safe_type = args.type_of_metric.replace(" ", "_").lower()
        csv_output_path = f"{safe_type}{int(args.min_value)}-{int(args.max_value)}_dev{int(args.deviation)}_interval{args.interval}_seed{args.seed if args.seed is not None else 'random'}_days{args.period_days}.csv"


    # Save CSV
    if args.values_only:
        data[['value']].to_csv(csv_output_path, index=False, header=False)
    else:
        data.to_csv(csv_output_path, index=False)

    print(f"Data saved to {csv_output_path}")

    if args.plot:
        # Plot
        fig, ax = plt.subplots(figsize=(18, 6))
        ax.plot(data['timestamp'], data['value'])
        ax.set_title(f'Simulated {args.type_of_metric.capitalize()} over {args.period_days} Days ({args.unit})')
        ax.set_xlabel('Time')
        ax.set_ylabel(f'{args.type_of_metric.capitalize()} ({args.unit})')
        ax.grid(True)

        # X-axis formatting
        ax.xaxis.set_major_locator(mdates.HourLocator(interval=6))
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%d %b %H:%M'))
        plt.xticks(rotation=45)

        plt.tight_layout()
        plt.show()

if __name__ == "__main__":
    main()
