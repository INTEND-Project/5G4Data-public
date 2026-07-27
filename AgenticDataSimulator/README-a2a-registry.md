# A2A Registry deployment notes (start5g / Simulator integration)

**Mirror:** `AgenticDataSimulator/a2a-registry/README-a2a-registry.md` — update both when changing this document.

---

This document summarizes changes and operational steps used to run **a2a-registry** at `~/arneme/a2a-agent-registry/a2a-registry` together with **Caddy**, **UFW**, the **Simulator intent-generation agent**, and PostgreSQL.

---

## 1. Problem overview

Several independent issues had to be resolved:

| Area | Symptom | Root cause |
|------|---------|------------|
| Agent startup | A2A registration failed before HTTP listen | Registration ran **before** `server.listen()` → registry fetched card → **502** |
| Caddy → agent | Public HTTPS returned **502**, localhost `:3011` OK | **UFW** blocked TCP from Docker **app network** to host port **3011** |
| Docker subnet | `ufw allow from 172.17.0.0/16` did not help | Caddy runs on **`172.21.x`** (`5g4data-tutorial-app-network`), not `172.17.x` |
| Registry DB | `column "icon_url" does not exist` (and similar) | Compose only applied **`001`** on first DB init; **`002`–`006`** never ran on existing volumes |
| Network path | Registry timeout / 502 fetching `wellKnownURI` | Registry **GETs** the public HTTPS URL; path must work through Caddy end-to-end |

---

## 2. Database migrations (backend)

**Issue:** `docker-compose.yml` mounts only `001_initial_schema.sql` into PostgreSQL `docker-entrypoint-initdb.d/`, which runs **once** when the data volume is empty. Existing deployments never received **`002_add_a2a_spec_fields.sql`** (`icon_url`, etc.) through **`006_add_maintainer_notes.sql`**.

**Change:** Automatic migration runner:

- **File:** `backend/app/db_migrations.py`
- **Behavior:** On startup, acquires a PostgreSQL **advisory lock**, ensures table **`schema_migrations`**, applies each `backend/migrations/versions/*.sql` **once** in sorted order (same spirit as `helm/.../migration-job.yaml`).
- **Wiring:** `await run_pending_sql_migrations()` runs **before** `await db.connect()` in:
  - `backend/app/main.py` (API lifespan)
  - `backend/worker.py` (worker main)
- **Tests:** `backend/tests/conftest.py` mocks `run_pending_sql_migrations` so unit tests do not hit a real DB.
- **Opt-out:** `SKIP_SQL_MIGRATIONS=true`

**Docs:** `README.md` (Development) and comments in `docker-compose.yml` / `docker-compose.prod.yml` describe init vs startup migrations.

**Operational note:** After pulling these changes, **restart** `api` and `worker` (rebuild images if `backend` is not bind-mounted).

---

## 3. UFW (host firewall)

**Issue:** Caddy runs **inside Docker** on **`5g4data-tutorial-app-network`** (e.g. container IP **`172.21.0.5`**, gateway **`172.21.0.1`**). It proxies to **`host.docker.internal:3011`** (typically **`172.17.0.1`** on the default bridge). Traffic **from `172.21.0.0/16` → host TCP 3011** was blocked by UFW.

**Symptoms:**

- `curl https://start5g-1.cs.uit.no/…/agent-card.json` → **502**
- `curl http://127.0.0.1:3011/…` on host → **200**
- `docker exec … wget http://host.docker.internal:3011/health` → **timeout**

**Rule that matched the actual Docker network:**

```bash
sudo ufw allow from 172.21.0.0/16 to any port 3011 proto tcp comment 'Simulator intent generation agent from 5g4data-tutorial-app-network'
sudo ufw reload
```

**Verification:**

```bash
docker exec 5g4data-tutorial-reverse-proxy-1 wget -qO- -T 3 "http://host.docker.internal:3011/health"
# Expect: {"status":"ok"}
```

If you run a **second** agent (e.g. observations on **3012**), add a matching UFW rule for that port from the same Docker subnet.

```bash
sudo ufw allow from 172.21.0.0/16 to any port 3012 proto tcp comment 'Observation agent from 5g4data-tutorial-app-network'
```

**Grafana** (host port **3002**, proxied at `/grafana`):

```bash
sudo ufw allow from 172.21.0.0/16 to any port 3002 proto tcp comment 'Grafana from 5g4data-tutorial-app-network'
sudo ufw reload
```

Verify from the Caddy container:

```bash
docker exec 5g4data-tutorial-reverse-proxy-1 wget -qO- -T 3 "http://host.docker.internal:3002/grafana/api/health"
```

Do **not** expose port 3002 publicly; remote users reach Grafana via HTTPS on port 443.

**Prometheus + Pushgateway** (host ports **9090** / **9091**, proxied at `/prometheus` and `/prometheus-pushgateway`):

```bash
# Remove any public/home rules for 9090/9091 if present, then:
sudo ufw allow from 172.21.0.0/16 to any port 9090 proto tcp comment 'Prometheus from 5g4data-tutorial-app-network'
sudo ufw allow from 172.21.0.0/16 to any port 9091 proto tcp comment 'Pushgateway from 5g4data-tutorial-app-network'
sudo ufw reload
```

Docker publishes lab service ports on all interfaces, so UFW alone does not block internet scanners. Restrict the `DOCKER-USER` chain via `/etc/docker-user-firewall/config` and systemd — see `[scripts/docker-user-firewall/README.md](scripts/docker-user-firewall/README.md)`:

```bash
sudo mkdir -p /etc/docker-user-firewall
sudo cp scripts/docker-user-firewall/config.example /etc/docker-user-firewall/config
sudo install -m 755 scripts/configure-docker-user-firewall.sh /usr/local/sbin/configure-docker-user-firewall.sh
sudo cp scripts/systemd/docker-user-firewall.service.example /etc/systemd/system/docker-user-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now docker-user-firewall.service
```

After editing `/etc/docker-user-firewall/config`: `sudo systemctl restart docker-user-firewall.service`.

Verify from the Caddy container:

```bash
docker exec 5g4data-tutorial-reverse-proxy-1 wget -qO- -T 3 "http://host.docker.internal:9090/-/healthy"
curl -sf "https://start5g-1.cs.uit.no/prometheus/-/healthy"
```

Do **not** expose ports 9090/9091 publicly; remote users reach Prometheus via HTTPS on port 443.

If you use an optional unified proxy on **18080** (§4.2), allow that port from the same Docker subnet as well.

---

## 4. Caddy configuration

**Location (example):** `INTEND-Project/5G4Data-public/5G4Data-Tutorial/Caddyfile` — site block `start5g-1.cs.uit.no`.

### 4.1 Per-agent Caddy routes (default)

Route each simulator agent clone directly to its host port (see `5G4Data-Tutorial/Caddyfile`):

```caddyfile
handle_path /5g4data-intent-generating-agent/* {
    reverse_proxy http://host.docker.internal:3011 {
        header_up Host localhost:3011
    }
}

handle_path /5g4data-intent-observation-generating-agent/* {
    reverse_proxy http://host.docker.internal:3012 {
        header_up Host localhost:3012
    }
}
```

Set **`A2A_AGENT_BASE_URL`** in each clone’s `.env` to the matching public path (for example `https://start5g-1.cs.uit.no/5g4data-intent-generating-agent`).

### 4.2 Optional unified proxy (legacy, not in this repository)

Some deployments use a registry-backed reverse proxy under a single prefix such as `/simulator-agents/*` → `host.docker.internal:18080`. That proxy is **not** part of `AgenticDataSimulator/`; if you run it locally, document its path in your own ops notes. Prefer **§4.1** for new setups.

- **Upstream:** `host.docker.internal` reaches the **host** from the Caddy container (requires `extra_hosts: host.docker.internal:host-gateway` or equivalent in Compose).
- **`header_up Host localhost:3011`:** Some stacks expect `Host` to match what the Node server would see locally; adjust if your HTTP stack validates `Host`.

**Ordering:** Keep agent routes **above** the catch-all `handle { reverse_proxy flask-app … }` so they are not swallowed by Flask.

**Reload after edits:**

```bash
docker compose restart reverse-proxy
# or: docker compose exec reverse-proxy caddy reload --config /etc/caddy/Caddyfile
```

---

## 5. Simulator agent configuration

**Environment (baseline or clone `.env`):**

| Variable | Purpose |
|----------|---------|
| `API_SERVER_ENABLED=true` | Serve OpenAPI + agent card on `API_SERVER_PORT` (e.g. **3011**) |
| `A2A_ENABLED=true` | Build card + registration |
| `A2A_REGISTRY_BASE_URL` | e.g. `https://start5g-1.cs.uit.no/a2a-registry` (registry API base; registration uses `POST …/api/agents/register`) |
| `A2A_AGENT_BASE_URL` | **Public** HTTPS URL **including** Caddy path prefix, **no** host port — e.g. `https://start5g-1.cs.uit.no/5g4data-intent-generating-agent` |
| `A2A_AGENT_CARD_PATH` | Default `/.well-known/agent-card.json` → full **`wellKnownURI`** = base + path |

**Registration semantics:** The registry receives **`POST {"wellKnownURI": "<URL>"}`** and **GETs that URL** server-side; it does not receive the JSON body of the card in that request.

---

## 6. SimulatorAgentKernel changes (`AgenticDataSimulator/SimulatorAgentKernel`)

Relevant fixes in **`src/index.ts`**:

1. **Defer A2A registration until after HTTP listen** when `apiServerEnabled && !options.prompt`, so the registry never hits `:3011` before the server binds.
2. **Registration after `await server.listen()`** for the API-server path, with optional **retries** and a short **hint** on persistent **5xx** / gateway errors.
3. **`package load` containerizes clones** by default: each clone gets a `Dockerfile` (from the baseline kernel) and a generated `docker-compose.yml`, then `docker compose up -d --build` runs automatically. Containers publish `API_SERVER_PORT` to the **host**, so Caddy can still reach agents via **`host.docker.internal:<port>`** without compose network changes. Use **`--no-container`** or **`CONTAINER_LOAD=false`** to skip Docker.

---

## 7. Registry API URLs (reference)

| Action | Method | Example |
|--------|--------|---------|
| Fetch agent card (browser / curl) | GET | `https://start5g-1.cs.uit.no/5g4data-intent-generating-agent/.well-known/agent-card.json` |
| Register agent card | POST | `https://start5g-1.cs.uit.no/a2a-registry/api/agents/register` with `{"wellKnownURI":"<HTTPS card URL>"}` |

---

## 8. Checklist for a new environment

1. Postgres: migrations **002–006** applied (automatic on API/worker startup after `db_migrations` change, or manual `psql` if needed).
2. Agent: **`A2A_AGENT_BASE_URL`** matches the public Caddy path; each agent listens on its **`API_SERVER_HOST` / `API_SERVER_PORT`** (e.g. 3011 vs 3012). With **`package load`**, agents run in Docker but still publish those ports on the **host**.
3. Caddy: per-agent `handle_path` routes (§4.1) or optional unified proxy (§4.2); reload Caddy.
4. UFW: allow TCP **3011** / **3012** (agents) **from the Docker network subnet** that hosts Caddy.
5. From Caddy container: **`wget http://host.docker.internal:3011/health`** succeeds.
6. From internet or host: **HTTPS** agent-card URL returns **200** JSON.
7. Start agent: log shows **`OpenAPI server running`** then **`[A2A] … Registered successfully`** and correct **`wellKnownURI`**.

---

## 9. Related files (quick index)

| Repository / path | What changed or matters |
|---------------------|-------------------------|
| `a2a-registry/backend/app/db_migrations.py` | Startup SQL migrations |
| `a2a-registry/backend/app/main.py`, `worker.py` | Call migrations before DB pool |
| `a2a-registry/docker-compose.yml` | Postgres init comment |
| `5G4Data-Tutorial/Caddyfile` | Per-agent routes to `host.docker.internal:<port>` |
| `AgenticDataSimulator/SimulatorAgentKernel/src/index.ts` | A2A registration after listen |

---

## 10. Fork divergence: agent API key auth

Simulator agents require **`X-Api-Key`** on agent-card and JSON-RPC endpoints. This fork wires `AGENT_API_KEYS` from `backend/.env` into:

- health worker (`worker.py`)
- registration / card fetch (`utils.py`, `smoke_test.py`)
- **Live terminal** chat proxy (`POST /api/agents/{id}/chat` in `main.py`)

Upstream open-source A2A Registry does **not** attach registry-held keys to the Live terminal proxy; see **`README-changes.md`** (section *Live terminal chat proxy authentication*) for merge notes.

After `package load` updates `backend/.env`, restart **`docker compose restart api worker`**.

---

*Document generated for operational handoff; adjust hostnames, paths, and ports to match your deployment.*
