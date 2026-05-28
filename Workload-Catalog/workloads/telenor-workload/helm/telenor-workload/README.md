# telenor-workload

Nginx + latency-exporter sidecar for InSustain energy-latency ML training.

## What it does

Deploys a pod with two containers:
- **nginx** — serves static content, consumes real CPU under load
- **latency-exporter** — makes requests to nginx at variable rates, measures latency, exposes Prometheus metrics

This generates correlated energy (Kepler) and latency data for training ML models.

## Metrics exposed (port 9101)

| Metric | Type | Description |
|--------|------|-------------|
| `nginx_request_duration_seconds` | histogram | Request latency distribution |
| `nginx_requests_total` | counter | Total requests made |
| `nginx_request_errors_total` | counter | Non-2xx or failed requests |
| `nginx_active_connections` | gauge | In-flight requests |
| `nginx_target_rps` | gauge | Current target RPS |

## Install

```bash
helm install telenor-workload . -n insustain
```

## Load patterns

Configure via `loadgen.pattern`:
- `sine` — oscillates between minRPS and maxRPS over periodSeconds
- `random` — random RPS each second within bounds
- `constant` — steady at midpoint of min/max
