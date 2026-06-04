# Upgrading Prometheus

This stack pins **Prometheus 3.12.x** and **Pushgateway 1.11.x** (see `docker-compose.yml` and `.env.example`).

## From Prometheus 2.x (e.g. v2.54)

Prometheus 3 uses a TSDB format that cannot be read by versions older than **2.55**. For the lab host, the simplest path is a **full TSDB wipe** before the first start on v3.

1. Stop writers (no observation scripts running in the Controller).
2. Stop the stack:
   ```bash
   cd Prometheus
   ./stop.sh
   ```
3. Wipe TSDB and restart with new images:
   ```bash
   ./delete-data.sh
   ```
   (`delete-data.sh` runs `docker compose down`, removes `tsdb/`, then `start.sh`.)
4. Or manually: update compose tags, then:
   ```bash
   docker compose pull
   # Keep external-url at host root (Caddy strips /prometheus); do not use …/prometheus here.
   export PROMETHEUS_EXTERNAL_URL=http://127.0.0.1:9090
   ./start.sh
   ```
   Public URLs in the Controller/agents stay `https://start5g-1.cs.uit.no/prometheus/…`.
5. Re-run observation scripts to repopulate metrics.
6. Smoke-check:
   - `curl -sf http://127.0.0.1:9090/-/healthy`
   - Prometheus UI → Status → Targets: `pushgateway` job **UP**
   - Short streaming + historic prometheus scripts in the Controller
   - Delete in Prometheus for one test intent

## Downgrade

After v3 has written to `tsdb/`, rollback is only safe to **Prometheus ≥ 2.55** with the same data. With a wiped TSDB, downgrade = pin old images in `docker-compose.yml`, `./delete-data.sh`, restart.

## Image pins

Override via environment or `Prometheus/.env`:

| Variable | Default |
|----------|---------|
| `PROMETHEUS_VERSION` | `v3.12.0` |
| `PUSHGATEWAY_VERSION` | `v1.11.2` |

`clear-intent-from-tsdb.sh` and the Controller TSDB rewrite use `PROMETHEUS_IMAGE=prom/prometheus:v3.12.0` by default.
