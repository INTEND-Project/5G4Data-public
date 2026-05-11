/**
 * OpenClawAgentsProxy — HTTP reverse proxy for OpenClaw agent clones.
 *
 * Edge (Caddy) forwards with strip_prefix: /openclaw-agents/{agent-slug}/…
 * This service receives: /{agent-slug}/… and proxies to the agent HTTP listener.
 *
 * Discovery: GET registry list (configurable paths). Match slug to name, wellKnownURI,
 * or (fallback) fetch agent cards by wellKnownURI until name matches.
 *
 * Upstream: registry row `upstream` / `listen_port`, else SLUG_TO_PORT_JSON + UPSTREAM_HOST.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const LISTEN_PORT = Number(process.env.PORT ?? "8080");
const LISTEN_HOST = process.env.LISTEN_HOST ?? "0.0.0.0";

const REGISTRY_API_BASE = (process.env.REGISTRY_API_BASE ?? "http://host.docker.internal:17001").replace(
  /\/$/,
  ""
);

const REGISTRY_LIST_PATHS = (process.env.REGISTRY_LIST_PATHS ?? "/api/agents,/agents").split(",");

const CACHE_TTL_MS = Math.max(1000, Number(process.env.CACHE_TTL_MS ?? "5000"));

const UPSTREAM_HOST = process.env.UPSTREAM_HOST ?? "host.docker.internal";

const SLUG_TO_PORT_JSON = process.env.SLUG_TO_PORT_JSON ?? "{}";

const CARD_FETCH_MAX = Math.max(0, Number(process.env.CARD_FETCH_MAX ?? "24"));

const DEBUG_ROUTES = ["1", "true", "yes", "on"].includes(
  String(process.env.DEBUG_ROUTES ?? "").trim().toLowerCase()
);

let slugToPort = {};
try {
  slugToPort = JSON.parse(SLUG_TO_PORT_JSON);
} catch {
  console.warn("[proxy] Invalid SLUG_TO_PORT_JSON, ignoring.");
  slugToPort = {};
}

/** @type {{ at: number, agents: unknown[] } | null} */
let cache = null;

const HOP_BY_HEADER = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "te",
  "trailer"
]);

function extractAgents(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.agents)) return data.agents;
  if (Array.isArray(data.data?.agents)) return data.data.agents;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

async function fetchJson(urlStr, { timeoutMs = 8000 } = {}) {
  const u = new URL(urlStr);
  const lib = u.protocol === "https:" ? https : http;
  const defaultPort = u.protocol === "https:" ? 443 : 80;
  const port = u.port ? Number(u.port) : defaultPort;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { accept: "application/json" },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : null);
          } catch (e) {
            reject(new Error(`Invalid JSON from ${urlStr}: ${String(e)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout: ${urlStr}`));
    });
    req.end();
  });
}

async function loadAgentsFromRegistry() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.agents;
  }
  let lastErr = "";
  for (const rawPath of REGISTRY_LIST_PATHS) {
    const path = rawPath.trim().startsWith("/") ? rawPath.trim() : `/${rawPath.trim()}`;
    const url = `${REGISTRY_API_BASE}${path}`;
    try {
      const data = await fetchJson(url);
      const agents = extractAgents(data);
      cache = { at: now, agents };
      console.log(`[proxy] Registry list OK path=${path} count=${agents.length}`);
      return agents;
    } catch (e) {
      lastErr = `${path}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new Error(`Registry list failed for all paths. Last: ${lastErr}`);
}

function firstPathSegment(pathname) {
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const parts = p.split("/").filter(Boolean);
  return parts[0] ?? "";
}

function stripFirstSegment(pathname) {
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const rest = parts.slice(1).join("/");
  return rest ? `/${rest}` : "/";
}

function normalizeRecord(raw) {
  const card = raw?.agent_card ?? raw?.agentCard ?? raw?.card ?? null;
  const name = raw?.name ?? card?.name ?? "";
  const wellKnownURI =
    raw?.wellKnownURI ?? raw?.well_known_uri ?? raw?.wellknown_uri ?? raw?.well_known ?? "";
  const upstream =
    raw?.upstream ?? raw?.internal_upstream ?? raw?.internal_base_url ?? raw?.direct_url ?? "";
  const port = raw?.listen_port ?? raw?.listenPort ?? raw?.port ?? raw?.tcp_port;
  return { raw, card, name: String(name), wellKnownURI: String(wellKnownURI), upstream, port };
}

function findAgentRecord(agents, slug) {
  for (const raw of agents) {
    const n = normalizeRecord(raw);
    if (n.name === slug) return n;
    if (n.wellKnownURI && n.wellKnownURI.includes(slug)) return n;
    const cardName = n.card?.name;
    if (cardName && String(cardName) === slug) return n;
  }
  return null;
}

async function findAgentRecordWithCardFallback(agents, slug) {
  const direct = findAgentRecord(agents, slug);
  if (direct) return direct;
  let tries = 0;
  for (const raw of agents) {
    if (tries >= CARD_FETCH_MAX) break;
    const n = normalizeRecord(raw);
    const wku = n.wellKnownURI;
    if (!wku || !wku.startsWith("http")) continue;
    tries += 1;
    try {
      const card = await fetchJson(wku, { timeoutMs: 6000 });
      const name = card?.name;
      if (name && String(name) === slug) {
        return {
          raw,
          card,
          name: String(name),
          wellKnownURI: wku,
          upstream: n.upstream,
          port: n.port
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function trimSlash(s) {
  return String(s).replace(/\/$/, "");
}

function buildUpstreamBase(found, slug) {
  if (found.upstream && String(found.upstream).trim()) {
    return trimSlash(found.upstream);
  }
  const p = found.port ?? found.raw?.listen_port ?? found.raw?.port;
  if (p !== undefined && p !== null && String(p).trim() !== "") {
    const port = Number(p);
    if (!Number.isNaN(port) && port > 0) {
      return `http://${UPSTREAM_HOST}:${port}`;
    }
  }
  const mapped = slugToPort[slug];
  if (mapped !== undefined && mapped !== null) {
    const port = Number(mapped);
    if (!Number.isNaN(port) && port > 0) {
      return `http://${UPSTREAM_HOST}:${port}`;
    }
  }
  return null;
}

function sendJson(res, status, obj) {
  const body = `${JSON.stringify(obj)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function filterRequestHeaders(headers, hostValue) {
  /** @type {Record<string, string | string[] | undefined>} */
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (HOP_BY_HEADER.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  out.host = hostValue;
  return out;
}

function filterResponseHeaders(headers) {
  /** @type {Record<string, string | string[] | undefined>} */
  const out = { ...headers };
  for (const hk of HOP_BY_HEADER) {
    delete out[hk];
    const key = Object.keys(out).find((x) => x.toLowerCase() === hk);
    if (key) delete out[key];
  }
  return out;
}

function proxyHttp(req, res, upstreamBase, targetPathname, search) {
  const base = trimSlash(upstreamBase);
  const u = new URL(`${base}/`);
  const lib = u.protocol === "https:" ? https : http;
  const defaultPort = u.protocol === "https:" ? 443 : 80;
  const port = u.port ? Number(u.port) : defaultPort;
  const pathPart = targetPathname.startsWith("/") ? targetPathname : `/${targetPathname}`;
  const fullPath = `${pathPart}${search}`;
  const hostHeader = `${u.hostname}${port !== defaultPort ? `:${port}` : ""}`;
  const opts = {
    method: req.method,
    hostname: u.hostname,
    port,
    path: fullPath,
    headers: filterRequestHeaders(req.headers, hostHeader),
    timeout: Number(process.env.UPSTREAM_TIMEOUT_MS ?? "120000")
  };
  const preq = lib.request(opts, (pres) => {
    res.writeHead(pres.statusCode ?? 502, filterResponseHeaders(pres.headers));
    pres.pipe(res);
  });
  preq.on("error", (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: "upstream_error", message: String(err.message) });
    } else {
      res.destroy();
    }
  });
  req.pipe(preq);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && u.pathname === "/health") {
      sendJson(res, 200, { status: "ok", service: "openclaw-agents-proxy" });
      return;
    }

    if (DEBUG_ROUTES && req.method === "GET" && u.pathname === "/__proxy/debug/registry") {
      const agents = await loadAgentsFromRegistry();
      const slim = agents.map((a) => {
        const n = normalizeRecord(a);
        return {
          name: n.name,
          wellKnownURI: n.wellKnownURI || undefined,
          upstream: n.upstream || undefined,
          port: n.port ?? undefined
        };
      });
      sendJson(res, 200, { count: slim.length, agents: slim });
      return;
    }

    const slug = firstPathSegment(u.pathname);
    if (!slug) {
      sendJson(res, 400, { error: "missing_agent_slug", hint: "Expected /{agent-slug}/…" });
      return;
    }

    const agents = await loadAgentsFromRegistry();
    const found = await findAgentRecordWithCardFallback(agents, slug);
    if (!found) {
      sendJson(res, 404, {
        error: "agent_not_found_in_registry",
        slug,
        hint:
          "No registry row matched this slug (by name, wellKnownURI, or fetched agent card name). Enable DEBUG_ROUTES=1 and GET /__proxy/debug/registry."
      });
      return;
    }

    const upstreamBase = buildUpstreamBase(found, slug);
    if (!upstreamBase) {
      sendJson(res, 503, {
        error: "no_upstream",
        slug,
        hint:
          "Registry row must include upstream or listen_port, or set SLUG_TO_PORT_JSON for this slug."
      });
      return;
    }

    const remainder = stripFirstSegment(u.pathname);
    proxyHttp(req, res, upstreamBase, remainder, u.search);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) {
      sendJson(res, 502, { error: "proxy_error", message: msg });
    }
  }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[proxy] listening http://${LISTEN_HOST}:${LISTEN_PORT} registry=${REGISTRY_API_BASE} paths=${REGISTRY_LIST_PATHS.join(",")}`
  );
});
