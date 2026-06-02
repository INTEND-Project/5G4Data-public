# AgenticDataSimulator

Multi-agent data generation simulator stack for the 5G4Data project.

## Components


| Directory                | Role                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `SimulatorAgentKernel`   | Generic runtime kernel; loads domain packages and creates package-bound agent clones |
| `SimulatorAgentPackages` | Domain package registry (intent generation, observations, templates)                 |
| `SimulatorController`    | Web workspace for script authoring, agent discovery, and execution                   |
| `Grafana`                | Grafana dashboard exports for the simulator (avalanche demo)                         |
| `a2a-registry`           | Agent-to-agent registry for discovery and registration                               |


See also `[README-a2a-registry.md](README-a2a-registry.md)` for deployment and Caddy/UFW integration notes.

## External dependencies and startup order

The simulator **agents** and **controller** rely on several other services. Start dependencies **before** `./agent-control start` and before [SimulatorController](#simulatorcontroller). On **start5g-1**, many of these run as shared lab infrastructure behind Caddy; locally you start only what you need.

### Dependency overview


| Dependency                                 | Used by                                                                              | Required for                            | Typical URL (start5g-1)                                               | Local / self-hosted                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **GraphDB**                                | Intent agent, observation agent, controller (KG targets), Grafana (SPARQL), metadata | Always (intents + observation metadata) | `https://start5g-1.cs.uit.no/graphdb/` (`:7200`)                      | Point agent/controller `.env` at your instance                                                                      |
| **Workload catalogue** (Helm Chart Museum) | Intent generation agent                                                              | Deployment / workload-aware intents     | `https://start5g-1.cs.uit.no/wchartmuseum`                            | Set `WORKLOAD_CATALOG_BASE_URL` in agent `.env`                                                                     |
| **TM Forum intent ontology** (files)       | Intent generation agent                                                              | SHACL validation, prompt context        | `ONTOLOGY_ROOT` in agent clone `.env`                                 | Set path to your local `TMForumIntentOntology` checkout                                                             |
| **A2A registry**                           | Agents (register on startup), controller (discover agents)                           | Controller script `discover …` lines    | `https://start5g-1.cs.uit.no/a2a-registry`                            | `[a2a-registry/](a2a-registry/)` — `docker compose up -d` (`:17001` API)                                            |
| **Caddy reverse proxy**                    | Public HTTPS for agents, GraphDB, registry, Prometheus                               | start5g-1 deployment only               | See [Infrastructure on start5g-1](#infrastructure-on-start5g-1-caddy) | Optional locally (use direct ports instead)                                                                         |
| **Prometheus + Pushgateway**               | Observation agent (`storage prometheus`)                                             | Prometheus observation storage only     | `…/prometheus`, `…/prometheus-pushgateway`                            | `[Prometheus/](Prometheus/)` — `./start.sh` (`:9090`, `:9091`)                                                      |
| **IntentReportQueryProxy**                 | Grafana timeseries panels (Infinity datasource)                                      | Viewing metrics in Grafana only         | `http://start5g-1.cs.uit.no:3010`                                     | `[./IntentReportQueryProxy/](./IntentReportQueryProxy/)` — `docker compose up -d`                                   |
| **Grafana** (+ SPARQL & Infinity plugins)  | Dashboards in `[Grafana/](Grafana/)`                                                 | Visualization only                      | `https://start5g-1.cs.uit.no/grafana`                                 | See `[Grafana/](Grafana/)` and `[../IntentDashboard/src/START-GRAFANA.md](../IntentDashboard/src/START-GRAFANA.md)` |
| **LLM provider** (OpenAI / Anthropic)      | Both agents                                                                          | Running agent turns                     | API keys in agent clone `.env`                                        | —                                                                                                                   |


**Not started by this repo:** GraphDB, workload catalogue, Caddy, and Grafana are usually operated separately on the lab host. This repository provides `./agent-control`, `Prometheus/`, `a2a-registry/`, and the controller app.

### Recommended startup order

```text
1. GraphDB                          (or confirm shared instance is up)
2. Workload catalogue               (if generating deployment intents)
3. A2A registry                     (if not using shared start5g-1 registry)
4. Prometheus + Pushgateway       (only if using storage prometheus)
5. IntentReportQueryProxy           (only if using Grafana timeseries dashboards)
6. Grafana                          (only for dashboards)
7. Simulator agents                 ./agent-control start
8. SimulatorController              cd SimulatorController && npm run build && npm run start
                                    (or `npm run dev` for development with hot reload)
```

After **re-cloning agents** (`package load`), restart the controller so it loads fresh `AGENT_API_KEYS` from `SimulatorController/.env`.

### Restart entire lab from current source

After pulling or editing code across agents, Controller, and registry consumers, rebuild and restart everything in one step (stops prod and dev Controllers, force-reloads agents, syncs `AGENT_API_KEYS`, restarts registry and proxy, rebuilds both Controllers):

```bash
cd ~/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator
./scripts/restart-lab-from-source.sh
```

Options: `--dev-mode=fast|hot|systemd`, `--with-prometheus`, `--skip-prod`, `--skip-dev`, `--skip-agents`, `--dry-run`. Systemd steps need `sudo` on start5g-1.

Agent-only forced reload (removes clones, `package load`, syncs keys — then restart Controller and `a2a-registry` api/worker, or run the script above):

```bash
./agent-control reload
```

### Start commands and health checks

**GraphDB** — confirm SPARQL responds (repository name varies by deployment):

```bash
curl -sf "https://start5g-1.cs.uit.no/graphdb/repositories/intents_and_intent_reports/size"
```

**Workload catalogue** — intent agent calls `WORKLOAD_CATALOG_BASE_URL` (default Chart Museum on start5g-1):

```bash
curl -sf "https://start5g-1.cs.uit.no/wchartmuseum/index.yaml" | head
```

**A2A registry** (local):

```bash
cd a2a-registry
docker compose up -d
curl -sf http://127.0.0.1:17001/health
```

See `[README-a2a-registry.md](README-a2a-registry.md)` for Caddy paths, UFW rules, and agent registration.

**Prometheus + Pushgateway** (local):

```bash
cd Prometheus
./start.sh
curl -sf http://127.0.0.1:9090/prometheus/-/healthy
curl -sf http://127.0.0.1:9091/metrics | head
```

**IntentReportQueryProxy** (for Grafana metric panels):

```bash
cd IntentReportQueryProxy
docker compose up -d --build
curl -sf http://127.0.0.1:3010/health
```

The proxy reads metric query URLs from GraphDB (`http://intent-reports-metadata`) and forwards range queries to Prometheus or GraphDB. Restart it after code changes: `docker compose up -d --build`.

**Grafana** — install SPARQL and Infinity datasource plugins, then import the **simulator dashboards from `[Grafana/](Grafana/)`** (these are the ones to use with this stack; older exports under `[../IntentDashboard/src/](../IntentDashboard/src/)` are superseded for the avalanche demo):


| File                                                                                                                                       | Purpose                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `[Grafana/SimulatorIntentDashboard.json](Grafana/SimulatorIntentDashboard.json)`                                                           | Intent overview (stats, intent list, drill-down links)                                       |
| `[Grafana/SimulatorIntentAndConditionMetricsTimeseriesDashboard.json](Grafana/SimulatorIntentAndConditionMetricsTimeseriesDashboard.json)` | Per-intent condition metric timeseries (opened from overview or the controller Grafana icon) |


Import both JSON files into Grafana. Setup steps (plugins, datasources): `[../IntentDashboard/src/START-GRAFANA.md](../IntentDashboard/src/START-GRAFANA.md)`. The controller Grafana icon uses `GRAFANA_TIMESERIES_DASHBOARD_UID=Simulator-5g4data-Metrics` (see `SimulatorController/.env.example`). Timeseries panels call IntentReportQueryProxy with `repository_id=${repository_id}` from the dashboard URL (same KG target as SPARQL panels). Re-import dashboards after JSON changes (`./Grafana/import-dashboards.sh`). Restart the proxy after updates (`cd IntentReportQueryProxy && docker compose up -d --build`).

**GraphDB security:** SPARQL panels use the `flandersmake-sparql-datasource` (not inline auth in dashboard JSON). After enabling GraphDB HTTP Basic auth, set `GRAPHDB_USERNAME` / `GRAPHDB_PASSWORD` in `SimulatorController/.env`, then run `./Grafana/configure-jwt-auth.sh` (renders `provisioning/datasources/graphdb-sparql.yaml` with real credentials, restarts Grafana). Grafana does not expand `${GRAPHDB_PASSWORD}` placeholders in provisioning files—always use the configure script after changing `.env`.

**Simulator agents:**

```bash
./agent-control start
curl -sf http://127.0.0.1:3011/health
curl -sf http://127.0.0.1:3012/health
```

### SimulatorController

Copy and edit `.env` from `.env.example` before the first run (`APP_BASE_PATH`, GraphDB/registry URLs, `GRAPHDB_USERNAME` / `GRAPHDB_PASSWORD`, `AGENT_API_KEYS`, etc.). When both `GRAFANA_BASE_URL` and `GRAFANA_ADMIN_PASSWORD` are set, registering a Controller user also creates a Grafana account with the same username and password (via the Grafana Admin API and the `admin` credentials in `.env`). For users created before that feature, run `cd SimulatorController && npm run grafana:provision-users` with `--password` or `scripts/grafana-user-passwords.env` (see `scripts/grafana-user-passwords.env.example`). For one-click Grafana from the Intents panel (no separate Grafana login), set `GRAFANA_JWT_SECRET` in `.env` and run `./Grafana/configure-jwt-auth.sh` to enable JWT URL login on the Grafana instance. Users listed in `GRAFANA_JWT_EDITOR_USERS` (default `arneme`) receive a JWT `role: Editor` claim for the main org; others stay Viewer.

**Production (recommended)** — faster and more responsive, especially when using the UI from a remote browser:

```bash
cd SimulatorController
npm install          # first time only
npm run build
npm run start
```

To accept connections from other hosts (e.g. start5g-1 behind a reverse proxy), bind on all interfaces:

```bash
npm run build
npx next start -H 0.0.0.0 -p 3000
```

**Surviving server reboot (start5g-1)** — Docker stacks in this repo use `restart: unless-stopped` once started with `docker compose up -d` (Prometheus, a2a-registry, IntentReportQueryProxy, Workload-Catalog, agent clones). GraphDB is a native install (e.g. `~/arneme/GraphDB/graphdb-11.1.1`) and should run under `graphdb.service`. For production, run the Controller under systemd: copy `[scripts/systemd/simulator-controller.service.example](scripts/systemd/simulator-controller.service.example)`, adjust paths, `npm run build`, then `systemctl enable --now simulator-controller`. The unit runs `npm run start` (`next start`) with `NODE_ENV=production`; it does **not** run `npm run build` on boot.

**After Controller code changes (systemd or manual prod):** rebuild, then restart—the running process does not pick up source edits on its own:

```bash
cd SimulatorController
npm run build
sudo systemctl restart simulator-controller   # if using systemd
# or stop npm run start and run it again when not using systemd
```

After recreating Grafana with `[Grafana/configure-jwt-auth.sh](Grafana/configure-jwt-auth.sh)`, the container keeps `--restart unless-stopped`; or run `docker update --restart unless-stopped grafana-3002-dev` on an existing container.

**Development (local hot reload)** — single instance on port 3000; can feel sluggish over high-latency remote links:

```bash
cd SimulatorController
npm install          # first time only
npm run dev
```

Open `http://localhost:3000/tmf-simulator` (see `APP_BASE_PATH` in `SimulatorController/.env`).

**Development lab instance (port 3001)** — run alongside prod so users on port 3000 are not disrupted. Dev uses `.env.dev`, base path `/tmf-simulator-dev`, and a separate SQLite file seeded from prod:


|           | Production                             | Dev lab                                                                 |
| --------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Port      | 3000                                   | 3001                                                                    |
| Process   | `next start` (systemd)                 | `next dev` (`npm run dev:lab`) or `next start` (`npm run dev:lab:fast`) |
| Env       | `.env`                                 | `.env.dev`                                                              |
| Base path | `/tmf-simulator`                       | `/tmf-simulator-dev`                                                    |
| SQLite    | prod DB (e.g. `dev.db`)                | `dev-lab.db` (copy of prod)                                             |
| Backends  | GraphDB, registry, Prometheus, Grafana | same URLs as prod                                                       |


First-time setup:

```bash
cd SimulatorController
cp .env.dev.example .env.dev
# Copy AGENT_API_KEYS, GRAFANA_* secrets from prod .env
npm run db:sync-from-prod    # copy prod SQLite → dev-lab.db
npm run dev:lab
```

**Dev lab feels sluggish?** `next dev` recompiles API routes on demand and is typically **10–20× slower** than `next start`. For everyday UI work on port 3001, prefer the fast dev lab (prod-like speed; rebuild after code changes):

```bash
cd SimulatorController
npm run dev:lab:build   # once, or after you change Controller code
npm run dev:lab:fast    # next start on port 3001
```

Keep `npm run dev:lab` when you need hot reload while editing React/TS files.

Refresh dev users/scripts from prod (stop dev first): `npm run db:sync-from-prod`

HTTPS (start5g-1): `https://start5g-1.cs.uit.no/tmf-simulator-dev/` via Caddy → port 3001 (see `[5G4Data-Tutorial/Caddyfile](../5G4Data-Tutorial/Caddyfile)`).

Optional always-on dev under systemd: `[scripts/systemd/simulator-controller-dev.service.example](scripts/systemd/simulator-controller-dev.service.example)`.

Source edits on dev are picked up via hot reload; prod is unchanged until you `npm run build` and restart `simulator-controller`.

### Minimal stacks


| Goal                                    | Start before agents                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Controller script, GraphDB storage only | GraphDB, A2A registry                                                                      |
| + Prometheus observation storage        | Above + Prometheus/Pushgateway; set observation clone `PUSHGATEWAY_URL` / `PROMETHEUS_URL` |
| + Grafana dashboards                    | Above + IntentReportQueryProxy + Grafana (+ re-run observations so metadata is fresh)      |
| Full start5g-1 lab                      | Shared GraphDB, catalogue, Caddy, registry; local Prometheus/Grafana/proxy as needed       |


## Typical workflow

1. Start [external dependencies](#external-dependencies-and-startup-order) required for your scenario.
2. Author or extend a package under `SimulatorAgentPackages/`.
3. Start both simulator agents (from this directory):
  ```bash
   ./agent-control start
  ```
   Other commands: `./agent-control stop`, `./agent-control restart`, `./agent-control reload`, `./agent-control --help`
   To run `agent-control` without `./`, add `bin` to your `PATH` once per shell (or add to `~/.bashrc`):

## Agent logs on the host

Each running agent container bind-mounts its log directory to the corresponding clone directory on the host:


| Agent             | Host log directory                                                       |
| ----------------- | ------------------------------------------------------------------------ |
| Intent generation | `SimulatorAgentKernel-5g4data-intent-generating-agent/logs/`             |
| Observations      | `SimulatorAgentKernel-5g4data-intent-observation-generating-agent/logs/` |


Agents are started with `--debug`, so you will typically see files such as `openclaw-agent-debug.jsonl` there (and additional observation logs under the observations agent clone).

To **stop** writing logs to the host filesystem, remove the bind mount from that agent's `docker-compose.yml`:

```yaml
    volumes:
      - ./logs:/app/logs
```

Then recreate the container (for example `./agent-control restart` or `docker compose up -d --force-recreate` in the clone directory). Logs will remain inside the container only unless you also remove `--debug` from the `command` in the same file.

## Authentication

Cloned agents enforce **API key authentication** on HTTP/A2A endpoints (A2A v0.3 `securitySchemes`). Keys are generated on `package load` and synced into `SimulatorController/.env` and `a2a-registry/backend/.env` as `AGENT_API_KEYS`. The registry uses these keys for health checks, registration smoke tests, and the website **Live terminal** chat proxy (fork divergence from upstream — see `[a2a-registry/README-changes.md](a2a-registry/README-changes.md)`). Restart `a2a-registry` **api** and **worker** after key updates. See `[SimulatorAgentKernel/README.md](SimulatorAgentKernel/README.md#authentication)` for details.

Configure the kernel via `SimulatorAgentKernel/.env` (see `.env.example`). The system prompt lives at `SimulatorAgentKernel/SYSTEM_PROMPT.md`.

## Observation storage (GraphDB vs Prometheus)

Controller scripts run `**create intent …` before `request observation-report …`** for the same intent alias. Storage is selected on the DSL line and reflected in generated intent Turtle (`icm:reportDestinations`) and in the observation agent runtime.

### DSL

```text
create intent using intentGen storage graphdb prompt "…" as myIntent
create intent using intentGen storage prometheus prompt "…" as myIntent
request observation-report using observationControl for myIntent instructions "…" as obsSession
request observation-report using observationControl for myIntent storage prometheus instructions "…" as obsSession
```

- Omitted `storage` on `create intent` defaults to `**graphdb**`.
- Omitted `storage` on `request observation-report` means no session override (use intent Turtle + create-intent choice).

**Resolution order** for observation datapoints: `request observation-report … storage` override → `icm:reportDestinations` in intent Turtle → `create intent … storage` alias map → default `graphdb`.

**Metadata** (how to query stored metrics) is always registered in the GraphDB metadata graph `http://intent-reports-metadata` (GraphDB SPARQL URL for graphdb storage, Prometheus `/api/v1/query` URL for prometheus storage).

### Environment (observation agent clone)

Set in the observation clone `.env` (see `SimulatorAgentPackages/5g4data-intent-observations/mappings/env.defaults.json`):


| Variable                                | Purpose                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GRAPHDB_ENDPOINT`                      | SPARQL endpoint for intents and observation Turtle                                                                                               |
| `GRAPHDB_USERNAME` / `GRAPHDB_PASSWORD` | HTTP Basic auth for GraphDB (synced from `SimulatorController/.env` on `package load`)                                                           |
| `GRAPHDB_NAMED_GRAPH`                   | Named graph for observation reports (e.g. `http://intent-reports`)                                                                               |
| `PROMETHEUS_URL`                        | Prometheus API base for GraphDB `hasQuery` metadata (IntentReportQueryProxy reads this URL); use `http://127.0.0.1:9090/prometheus` on start5g-1 |
| `PROMETHEUS_REMOTE_WRITE_URL`           | Historic observation batch write endpoint; use `http://host.docker.internal:9090/prometheus/api/v1/write` from Dockerized agent                  |
| `PUSHGATEWAY_URL`                       | Pushgateway base for streaming samples; use `http://host.docker.internal:9091` from Dockerized agent                                             |
| `NO_GRAPHDB`                            | When `true`, skip GraphDB observation inserts (metadata registration still attempted)                                                            |


### Start Prometheus and Pushgateway

Prometheus and Pushgateway are **not** started by `./agent-control` or the tutorial `docker compose`. Use the stack under `[Prometheus/](Prometheus/)` (Docker required).

**Start** (from `AgenticDataSimulator`):

```bash
cd Prometheus
./start.sh
```

**Stop:**

```bash
cd Prometheus
./stop.sh
```

TSDB time series persist in `**Prometheus/tsdb/**` across `./stop.sh` and `./start.sh`. To wipe all Prometheus and Pushgateway metrics, run `./delete-data.sh` in `Prometheus/`.

This runs Pushgateway on **9091** and Prometheus on **9090**. Prometheus scrapes Pushgateway using `[Prometheus/prometheus.yml](Prometheus/prometheus.yml)` (pushed intent metrics use job `intent_reports`; internal `pushgateway_`* metrics are dropped). The same config sets `storage.tsdb.out_of_order_time_window: 365d` so historic observation batches can remote-write samples with past `obtainedAt` timestamps.

**On start5g-1** (so the Prometheus UI links work behind Caddy):

```bash
export PROMETHEUS_EXTERNAL_URL=https://start5g-1.cs.uit.no/prometheus
./start.sh
```

Ensure the [Caddy routes](#infrastructure-on-start5g-1-caddy) are active so agents can reach the services over HTTPS. Reload Caddy after `Caddyfile` changes (`docker compose up -d` in `5G4Data-Tutorial/`).

**Observation agent `.env`** (after services are up; `package load` applies defaults from `mappings/env.defaults.json` via `onPackageLoad`):


| Variable                      | Purpose (start5g-1 Docker agent)                                                 |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `PROMETHEUS_URL`              | Metadata/query base for proxy on host: `http://127.0.0.1:9090/prometheus`        |
| `PROMETHEUS_REMOTE_WRITE_URL` | Historic batch write: `http://host.docker.internal:9090/prometheus/api/v1/write` |
| `PUSHGATEWAY_URL`             | Streaming push: `http://host.docker.internal:9091`                               |
| `SYNTH_OBS_PROM_FLUSH_CHUNK`  | Historic remote-write batch size (default 10000; agent worker env)               |



| Where you run agents                | `PROMETHEUS_URL`                         | `PUSHGATEWAY_URL`                                    |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| Host (no Docker)                    | `http://127.0.0.1:9090/prometheus`       | `http://127.0.0.1:9091`                              |
| start5g-1 (via Caddy, public HTTPS) | `https://start5g-1.cs.uit.no/prometheus` | `https://start5g-1.cs.uit.no/prometheus-pushgateway` |


When agents run **inside Docker** on start5g-1, use the table above (metadata on `127.0.0.1`, writes via `host.docker.internal`). The kernel-generated clone `docker-compose.yml` adds `extra_hosts` for `host.docker.internal` automatically on `package load`.

Defaults are in `SimulatorAgentPackages/5g4data-intent-observations/mappings/env.defaults.json`.

**Quick checks:**

```bash
curl -s http://127.0.0.1:9091/metrics | head
curl -sf http://127.0.0.1:9090/prometheus/-/healthy
```

### Infrastructure on start5g-1 (Caddy)


| Service     | URL                                                  | Backend (host) |
| ----------- | ---------------------------------------------------- | -------------- |
| GraphDB     | `https://start5g-1.cs.uit.no/graphdb/`               | `:7200`        |
| Prometheus  | `https://start5g-1.cs.uit.no/prometheus`             | `:9090`        |
| Pushgateway | `https://start5g-1.cs.uit.no/prometheus-pushgateway` | `:9091`        |
| Grafana     | `https://start5g-1.cs.uit.no/grafana`                | `:3002`        |


Caddy routes are defined in `[5G4Data-Tutorial/Caddyfile](../5G4Data-Tutorial/Caddyfile)`.

**Grafana behind `/grafana/`** — Grafana runs with `GF_SERVER_SERVE_FROM_SUB_PATH=true` and `GF_SERVER_ROOT_URL=https://start5g-1.cs.uit.no/grafana/`. Caddy forwards `/grafana*` to host port 3002 **without** stripping the prefix. Remote users reach Grafana over HTTPS on port 443 only; UFW needs a rule from the Caddy Docker subnet (`172.21.0.0/16`) to host port 3002, not a public allow on 3002. Re-run `./Grafana/configure-jwt-auth.sh` after changing `GRAFANA_BASE_URL` in `SimulatorController/.env`.

**GraphDB Workbench behind `/graphdb/` (start5g-1)** — Caddy strips the `/graphdb` prefix before forwarding to port 7200, but the Workbench ships with `<base href="/">`, so the UI loads JS/CSS from the site root and stays on “GraphDB Workbench is loading…”. On start5g-1 this has been fixed on the native install (`~/arneme/GraphDB/graphdb-11.1.1`):

1. Set `graphdb.external-url = https://start5g-1.cs.uit.no/graphdb/` in `conf/graphdb.properties`, then restart GraphDB (`sudo systemctl restart graphdb`).
2. Patch `lib/workbench/index.html`: change `<base href="/">` to `<base href="/graphdb/">`.

**Re-apply after a GraphDB upgrade** — both steps touch files under the GraphDB install directory (not this repo); upgrading or reinstalling GraphDB can overwrite `index.html` and reset `graphdb.properties`.

After code changes, reload observation package tools into the clone: `package load` from `SimulatorAgentKernel` or `./agent-control restart`.

# Manual load agents

This is an alternative way to start agents manually.

1. From `SimulatorAgentKernel`, run `npx tsx src/index.ts package load ../SimulatorAgentPackages/package-name` (package-name is the name of the package folder, e.g. 5g4data-intent-generation).
2. Install node packages: (e.g. *cd ../clone-name* and *npm install* where clone-name is the resulting clone folder, e.g. SimulatorAgentKernel-5g4data-intent-generating-agent)
3. Run the resulting clone form the clone-folder (e.g.  *npx tsx src/index.ts --debug*).

