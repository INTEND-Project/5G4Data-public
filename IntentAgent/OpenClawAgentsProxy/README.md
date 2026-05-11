# OpenClawAgentsProxy

HTTP reverse proxy for **OpenClaw** agent clones. It resolves the correct upstream from the **A2A registry** (agent list + optional per-row `listen_port` / `upstream`) and forwards `/{agent-slug}/…` to the Node OpenAPI server.

## Why

- Edge TLS (Caddy) can expose a **stable path** (`/openclaw-agents/…`) while agents use **`--port`** or change ports over time.
- The proxy reads the registry periodically and matches the first URL path segment to an agent **card `name`** (or `wellKnownURI` containing the slug, or by fetching cards when needed).

## URL shape

1. Caddy: `handle_path /openclaw-agents/*` → this service (strips `/openclaw-agents`).
2. Proxy receives: `/{agent-slug}/v1/sessions`, `/{agent-slug}/.well-known/agent-card.json`, etc.
3. Proxy forwards to: `http://UPSTREAM_HOST:{port}/v1/sessions` (first segment stripped).

Set each agent’s public base to the routed prefix, for example:

- `A2A_AGENT_BASE_URL=https://start5g-1.cs.uit.no/openclaw-agents/5g4data-intent-generation-agent`

Registration `wellKnownURI` then becomes:

- `https://start5g-1.cs.uit.no/openclaw-agents/5g4data-intent-generation-agent/.well-known/agent-card.json`

## Registry contract

The proxy calls `GET {REGISTRY_API_BASE}{path}` for each path in `REGISTRY_LIST_PATHS` (default `/api/agents`, `/agents`) until one returns JSON.

Each agent entry may include (any of):

| Field (accepted aliases) | Meaning |
|---------------------------|---------|
| `name` / nested `agent_card.name` | Must match URL slug (e.g. `5g4data-intent-generation-agent`) |
| `wellKnownURI` | Used for matching and optional card fetch |
| `upstream` / `internal_upstream` / `internal_base_url` | Full base URL for the Node process (e.g. `http://host.docker.internal:3011`) |
| `listen_port` / `port` | TCP port on `UPSTREAM_HOST` |

If the registry does **not** expose port/upstream yet, set **`SLUG_TO_PORT_JSON`** (see `docker-compose.yml`) so the proxy can still reach agents on the host.

## Run with Docker

From this directory:

```bash
docker compose up --build -d
```

Default publishes **`18080:8080`** on the Docker host so Caddy (in Docker) can use `reverse_proxy http://host.docker.internal:18080`.

Health:

```bash
curl -sS http://127.0.0.1:18080/health
```

Operator debug (set `DEBUG_ROUTES=1`):

```bash
curl -sS http://127.0.0.1:18080/__proxy/debug/registry
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Listen port inside the container |
| `LISTEN_HOST` | `0.0.0.0` | Bind address |
| `REGISTRY_API_BASE` | `http://host.docker.internal:17001` | Registry API origin (no trailing slash) |
| `REGISTRY_LIST_PATHS` | `/api/agents,/agents` | Comma-separated paths to try |
| `UPSTREAM_HOST` | `host.docker.internal` | Host where OpenClaw agents listen |
| `SLUG_TO_PORT_JSON` | `{}` | JSON map slug → port when registry has no port |
| `CACHE_TTL_MS` | `5000` | Registry list cache TTL |
| `CARD_FETCH_MAX` | `24` | Max agent-card fetches when slug not found in list payload |
| `UPSTREAM_TIMEOUT_MS` | `120000` | Upstream request timeout |
| `DEBUG_ROUTES` | off | Set `1` to enable `GET /__proxy/debug/registry` |

## Caddy

See `5G4Data-Tutorial/Caddyfile` in this repo: a single `handle_path /openclaw-agents/*` block forwards to this proxy. Remove or avoid duplicate per-agent `handle_path` routes that target the same host ports unless you intentionally bypass the proxy.
