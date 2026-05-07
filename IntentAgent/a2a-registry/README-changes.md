# README Changes: Hostname Uniqueness Policy

## What changed

The registry no longer enforces "one agent per host" by default.

Previously, registration could fail with:

- `An agent from this host is already registered ...`

when a second agent was registered from the same domain/hostname, even if it used a different path and represented a different agent.

## Why this was changed

Serving multiple agents from a single host is a common deployment model:

- different path prefixes on one domain (for example `/agent-a` and `/agent-b`)
- reverse proxy routing to different internal services
- multiple agent cards under the same hostname

Blocking this pattern made normal multi-agent deployments difficult.

## New behavior

Registration now allows multiple agents from the same hostname by default.

The registry still prevents duplicate registrations by:

- exact `wellKnownURI` match
- duplicate `(name, author)` card identity

## Configuration flag

A new backend environment variable controls optional host-level uniqueness:

- `ENFORCE_UNIQUE_HOSTNAME=false` (default)
  - allows multiple agents on the same hostname
- `ENFORCE_UNIQUE_HOSTNAME=true`
  - restores previous behavior (reject second visible agent from same host)

Defined in:

- `backend/app/config.py`
- `backend/.env.example`

## API endpoints affected

The policy applies to both registration flows:

- `POST /agents/register`
- `POST /agents`

## Compatibility note

If your deployment previously depended on host-level uniqueness, set:

```bash
ENFORCE_UNIQUE_HOSTNAME=true
```

Otherwise, no action is required.

## Local admin key setup (Docker Compose)

To enable admin-only endpoints (for example `DELETE /agents/{id}`) in local Docker Compose:

1. Add a root-level `.env` file (next to `docker-compose.yml`) with:
   - `ADMIN_API_KEY=<your-secret-value>`
2. Pass it through to the API service in `docker-compose.yml`:
   - `ADMIN_API_KEY: ${ADMIN_API_KEY:-}`
3. Restart the API container:
   - `docker compose restart api`

In this environment, this was applied exactly that way:

- created `a2a-registry/.env` with a generated key
- wired `ADMIN_API_KEY` into `docker-compose.yml` for service `api`
- restarted `a2a-registry-api` so the variable is active

## Soft-delete re-registration fix

During validation, registration still failed after delete with:

- `duplicate key value violates unique constraint "agents_well_known_uri_key"`

Root cause:

- `DELETE /agents/{id}` is soft-delete (`hidden=true`)
- app-level duplicate checks were updated to ignore hidden rows
- but database schema still had a global unique constraint on `well_known_uri`

Resolution:

- added migration `backend/migrations/versions/007_allow_reregister_after_soft_delete.sql`
- drops legacy `agents_well_known_uri_key` constraint/index
- adds partial unique index:
  - `idx_agents_well_known_uri_visible_unique`
  - uniqueness enforced only where `hidden=false`
- recreated API and worker containers so startup migrations are applied:
  - `docker compose up -d --force-recreate api worker`

Verification used:

- inspected `agents` table indexes in Postgres (`\d+ agents`)
- confirmed old `agents_well_known_uri_key` is absent
- confirmed `idx_agents_well_known_uri_visible_unique` is present

## UI routing fix for `/a2a-registry` base path

Issue observed:

- opening an agent via `INSPECT` worked, but closing the inspection panel changed the browser URL to `https://start5g-1.cs.uit.no/` instead of `https://start5g-1.cs.uit.no/a2a-registry/`.

Root cause:

- `website/src/components/HomeApp.jsx` used hard-coded root routes (`/` and `/agents/:id`) instead of respecting the app base path (`import.meta.env.BASE_URL`).

Resolution:

- added base-path helpers in `HomeApp.jsx`:
  - `normalizeBasePath()`
  - `withBase()`
  - `stripBasePath()`
- updated URL push/parse logic to:
  - push home to `withBase('/')`
  - push inspect routes to `withBase('/agents/:id')`
  - parse route matches from `stripBasePath(window.location.pathname)`

Result:

- closing `INSPECT` now returns to `/a2a-registry/` when deployed under that prefix, while still working correctly for root (`/`) deployments.
