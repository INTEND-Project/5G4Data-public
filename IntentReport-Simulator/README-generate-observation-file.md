## Observation File Generator (generate_observation_file.py)

This script generates CSV files with ISO8601 UTC timestamps and simulated values for a single metric. It supports multiple generation modes (random, diurnal, walk, trend), optional anomaly injection, auto-naming of output files, and reproducible runs via random seeds.

### Output format
- CSV with header: `timestamp,<metric-name>`
- Timestamps: ISO8601 UTC with `Z` suffix, e.g., `2025-10-07T00:00:00Z`
- Header comments: Configuration parameters and condition descriptions are included as `#` comments

### Basic usage
```bash
python generate_observation_file.py \
  --start-time 2025-10-07T00:00:00Z \
  --end-time 2025-10-08T00:00:00Z \
  --frequency 5m \
  --min 10 --max 35 \
  --metric-name latency_ms \
  --mode diurnal \
  --seed 42 \
  --decimal-places 0
```

The script prints the output filename when finished. If `--output` is omitted, it auto-generates a descriptive filename.

### Auto-generated filename
If `--output` is not provided, the filename format is:
```
observations_<metric>_Start:<ISO8601Z>_End:<ISO8601Z>_mode<mode>_freq<seconds>s_min<min>_max<max>[_anomaly<spec>][_seedX][_dpY].csv
```
Example:
```
observations_latency_ms_Start:2025-10-07T00:00:00Z_End:2025-10-08T00:00:00Z_modediurnal_freq300s_min10.0_max35.0_anomalypeak_rate0.05_dur3_amp0.3_dirboth_seed42_dp0.csv
```

### Arguments
- `--start-time` (required): Start timestamp, ISO8601 UTC (e.g., `2025-10-07T00:00:00Z`).
- `--end-time` (required): End timestamp, ISO8601 UTC.
- `--frequency` (required): Interval between samples. Either integer seconds (e.g., `60`) or units (`15s`, `5m`, `1h`).
- `--min` (required): Minimum value (inclusive).
- `--max` (required): Maximum value (inclusive).
- `--metric-name` (optional): Column name for values; default `value`.
- `--mode` (optional): Value generation mode. One of `random`, `diurnal`, `walk`, `trend`. Default `random`.
- `--anomaly` (optional): Anomaly strategy. One of `none`, `random`, `fixed`, `peak`. Default `none`.
- `--anomaly-rate` (optional): For `random`/`peak`, probability to start an anomaly at a sample (0..1). Default `0.01`.
- `--anomaly-interval` (optional): For `fixed`, interval between anomaly starts (e.g., `1h`). Required if `--anomaly fixed`.
- `--anomaly-duration-samples` (optional): Duration of each anomaly in samples. Default `3`.
- `--anomaly-amplitude-frac` (optional): Amplitude as a fraction of `(max-min)`. Default `0.3`.
- `--anomaly-direction` (optional): `spike`, `dip`, or `both` (default `both`).
- `--peak-start-hour` / `--peak-end-hour` (optional): UTC hours window for `peak` anomalies. Default `16-20`.
- `--seed` (optional): Random seed for reproducibility.
- `--decimal-places` (optional): Number of decimals in output values. Default `3`.
- `--output` (optional): Output CSV path. If omitted, a descriptive name is generated in the current directory.

### Modes
- `random`: Independent uniform values in `[min, max]`.
- `diurnal`: Daily sinusoidal baseline with Gaussian noise (UTC day), clamped to range.
- `walk`: Mean-reverting random walk (Ornstein–Uhlenbeck-like), clamped to range.
- `trend`: Linear trend from `min` to `max` over the interval plus noise, clamped to range.

### Anomaly Behavior
- **When `--anomaly none`**: All generated values stay strictly within the `[min, max]` range
- **When anomalies are enabled**: Anomalous values can exceed the `[min, max]` range by the specified amplitude
- **Anomaly types**:
  - `random`: Random probability-based anomaly starts
  - `fixed`: Regular interval-based anomaly starts
  - `peak`: Anomalies only during specified peak hours

### Min/Max Value Deduction for Intent Conditions
When used with the Intent Report Simulator, the script automatically deduces appropriate min/max values based on TM Forum Intent ontology quan operators:

- **`atMost`**: max = exact constraint value, min = 10% of constraint
- **`atLeast`**: min = exact constraint value, max = 150% of constraint  
- **`larger`/`greater`**: min = 110% of constraint, max = 200% of constraint
- **`smaller`**: max = 90% of constraint, min = 10% of constraint
- **`mean`/`median`**: min/max = constraint ± 30% spread
- **`inRange`**: min = 10% of constraint, max = exact constraint value

This ensures generated values respect the semantic meaning of each quan operator.

### Examples
Random within range, 1-minute frequency:
```bash
python generate_observation_file.py \
  --start-time 2025-10-07T00:00:00Z \
  --end-time 2025-10-07T06:00:00Z \
  --frequency 60 \
  --min 100 --max 1000 \
  --metric-name bandwidth_mbps \
  --mode random
```

Diurnal pattern with noise:
```bash
python generate_observation_file.py \
  --start-time 2025-10-07T00:00:00Z \
  --end-time 2025-10-08T00:00:00Z \
  --frequency 5m \
  --min 10 --max 35 \
  --metric-name latency_ms \
  --mode diurnal \
  --seed 42 \
  --decimal-places 0
```

Mean-reverting random walk:
```bash
python generate_observation_file.py \
  --start-time 2025-10-07T00:00:00Z \
  --end-time 2025-10-07T12:00:00Z \
  --frequency 15s \
  --min 50 --max 500 \
  --metric-name bandwidth_mbps \
  --mode walk \
  --anomaly random --anomaly-rate 0.02 --anomaly-duration-samples 4 --anomaly-amplitude-frac 0.5 --anomaly-direction spike \
  --seed 1
```

Linear trend with noise:
```bash
python generate_observation_file.py \
  --start-time 2025-10-07T00:00:00Z \
  --end-time 2025-10-07T06:00:00Z \
  --frequency 30 \
  --min 5 --max 50 \
  --metric-name latency_ms \
  --mode trend \
  --anomaly fixed --anomaly-interval 30m --anomaly-duration-samples 2 --anomaly-direction dip --anomaly-amplitude-frac 0.2

Peak-hours anomalies with diurnal base:
```bash
python generate_observation_file.py \
  --start-time 2025-10-07T00:00:00Z \
  --end-time 2025-10-08T00:00:00Z \
  --frequency 5m \
  --min 10 --max 35 \
  --metric-name latency_ms \
  --mode diurnal \
  --anomaly peak --anomaly-rate 0.05 --peak-start-hour 16 --peak-end-hour 20
```
```

### Notes
- All timestamps are handled and emitted in UTC.
- Values are always clamped to `[min, max]` when `--anomaly none`.
- When anomalies are enabled, anomalous values can exceed the min/max range.
- For reproducibility across modes, provide `--seed`.
- Configuration parameters and condition descriptions are included as header comments in generated CSV files.


