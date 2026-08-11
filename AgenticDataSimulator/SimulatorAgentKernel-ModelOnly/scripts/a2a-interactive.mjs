#!/usr/bin/env node
/**
 * Interactive A2A (v0.3-style JSON-RPC) client for SimulatorAgentKernel.
 *
 * Usage:
 *   node scripts/a2a-interactive.mjs
 *   node scripts/a2a-interactive.mjs --base http://127.0.0.1:3011
 *   node scripts/a2a-interactive.mjs --rpc http://127.0.0.1:3011/custom/v1
 *
 * Env:
 *   A2A_BASE_URL        — Where to GET the agent card (default: http://127.0.0.1:3011)
 *   A2A_AGENT_CARD_PATH — Path to the card (default: /.well-known/agent-card.json)
 *   A2A_RPC_URL         — Optional; if set, JSON-RPC POST goes here instead of card.url
 *   AGENT_API_KEY       — API key for protected agent endpoints (also read from cwd .env)
 *   AGENT_API_KEY_HEADER — Header name (default: X-Api-Key)
 *
 * JSON-RPC POSTs target the card field `url` (e.g. https://host/<agent-slug>/v1). The reverse proxy must
 * map that public prefix to upstream root routes (e.g. Caddy `handle_path` or `uri strip_prefix`): SimulatorAgentKernel
 * serves /.well-known/… and /v1 only at / on the listened port.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const INITIAL_USER_MESSAGE =
  "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner";

function textFromParts(parts) {
  if (!Array.isArray(parts)) return "";
  const chunks = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    if (p.kind !== undefined && p.kind !== "text") continue;
    if (typeof p.text === "string" && p.text.length > 0) chunks.push(p.text);
  }
  return chunks.join("\n").trim();
}

/** @param {unknown} artifact */
function textFromArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return "";
  return textFromParts(artifact.parts);
}

function getArg(flag, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (raw) return raw.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function trimSlash(s) {
  return s.replace(/\/$/, "") || "";
}

/**
 * Parses JSON-RPC envelope and derives task binding + user-visible text + whether agent asked for input.
 * @param {unknown} envelope
 */
function interpretSendMessageResult(envelope) {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, errorText: "Empty or invalid JSON-RPC response." };
  }
  /** @type {{ error?: { code?: number; message?: string; data?: { details?: string } }; result?: unknown }} */
  const e = envelope;
  if (e.error) {
    const msg = [e.error.message, e.error.data?.details].filter(Boolean).join(" — ");
    return {
      ok: false,
      errorText: `[${e.error.code}] ${msg}`
    };
  }

  const result = e.result;
  if (result === undefined || result === null) {
    return { ok: false, errorText: "JSON-RPC result missing." };
  }
  if (typeof result !== "object") {
    return {
      ok: true,
      taskId: null,
      contextId: null,
      visibleText: String(result),
      needsInput: false
    };
  }

  /** @type {Record<string, unknown>} */
  const r = /** @type {Record<string, unknown>} */ (result);

  /** @type {{ state?: string; message?: { parts?: unknown } } | undefined} */
  const status = /** @type {any} */ (r.status);

  /** Direct message reply */
  if (r.kind === "message") {
    return {
      ok: true,
      taskId: typeof r.taskId === "string" ? r.taskId : null,
      contextId: typeof r.contextId === "string" ? r.contextId : null,
      visibleText: textFromParts(r.parts),
      needsInput: false
    };
  }

  const taskId = typeof r.id === "string" ? r.id : null;
  const contextId = typeof r.contextId === "string" ? r.contextId : null;
  const state = status?.state;

  if (state === "input-required") {
    const agentTurn = status?.message;
    const hint = agentTurn ? textFromParts(agentTurn.parts) : "(Agent requested further input.)";
    return {
      ok: true,
      taskId,
      contextId,
      visibleText: hint,
      needsInput: true
    };
  }

  /** Completed / working-with-artifacts: surface artifact text */
  if (Array.isArray(r.artifacts) && r.artifacts.length > 0) {
    const combined = r.artifacts.map(textFromArtifact).filter(Boolean).join("\n\n");
    if (combined) {
      return {
        ok: true,
        taskId,
        contextId,
        visibleText: combined,
        needsInput: false
      };
    }
  }

  /** Fallback: stringify minimal task info */
  return {
    ok: true,
    taskId,
    contextId,
    visibleText:
      typeof r === "object" && r !== null
        ? JSON.stringify(r, null, 2)
        : String(r),
    needsInput: false
  };
}

function readDotEnvKey(key) {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const text = readFileSync(envPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      if (line.slice(0, eq).trim() !== key) continue;
      return line.slice(eq + 1).trim();
    }
  } catch {
    // ignore missing .env
  }
  return undefined;
}

function resolveApiKeyHeaderName(card) {
  const schemes = card?.securitySchemes;
  if (schemes && typeof schemes === "object") {
    for (const scheme of Object.values(schemes)) {
      if (
        scheme &&
        typeof scheme === "object" &&
        scheme.type === "apiKey" &&
        scheme.in === "header" &&
        typeof scheme.name === "string"
      ) {
        return scheme.name;
      }
    }
  }
  return process.env.AGENT_API_KEY_HEADER?.trim() || "X-Api-Key";
}

function buildAuthHeaders(card) {
  const apiKey = process.env.AGENT_API_KEY?.trim() || readDotEnvKey("AGENT_API_KEY");
  if (!apiKey) return {};
  const headerName = resolveApiKeyHeaderName(card);
  return { [headerName]: apiKey };
}

/**
 * @param {string} rpcUrl
 * @param {object} payload
 * @param {Record<string, string>} authHeaders
 */
async function postJsonRpc(rpcUrl, payload, authHeaders = {}) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "a2a-version": "0.3",
      ...authHeaders
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  /** @type {unknown} */
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    return {
      ok: false,
      errorText: `HTTP ${res.status}: non-JSON body: ${text.slice(0, 500)}`
    };
  }
  if (!res.ok) {
    const errLine =
      data && typeof data === "object" && "error" in data
        ? JSON.stringify(/** @type {object} */ (data).error)
        : text.slice(0, 500);
    return { ok: false, errorText: `HTTP ${res.status}: ${errLine}` };
  }
  return { ok: true, data };
}

async function main() {
  const base =
    trimSlash(getArg("--base", process.env.A2A_BASE_URL?.trim() || "http://127.0.0.1:3011")) || "http://127.0.0.1:3011";
  const cardPath =
    process.env.A2A_AGENT_CARD_PATH?.trim() || "/.well-known/agent-card.json";
  const cardUrl = `${base}${cardPath.startsWith("/") ? cardPath : `/${cardPath}`}`;

  process.stderr.write(`Fetching agent card: ${cardUrl}\n`);

  const bootstrapAuthHeaders = buildAuthHeaders(undefined);
  let cardRes;
  try {
    cardRes = await fetch(cardUrl, {
      headers: { accept: "application/json", ...bootstrapAuthHeaders }
    });
  } catch (err) {
    process.stderr.write(`Failed to reach agent card: ${String(err)}\n`);
    process.exit(1);
  }
  if (!cardRes.ok) {
    process.stderr.write(`Agent card GET failed: HTTP ${cardRes.status}\n`);
    process.exit(1);
  }
  /** @type {{ url?: string; name?: string }} */
  let card;
  try {
    card = await cardRes.json();
  } catch {
    process.stderr.write("Agent card response was not JSON.\n");
    process.exit(1);
  }
  if (!card.url || typeof card.url !== "string") {
    process.stderr.write("Agent card missing string field `url` (JSON-RPC endpoint).\n");
    process.exit(1);
  }

  const explicitRpc = getArg("--rpc", process.env.A2A_RPC_URL?.trim() ?? "");

  const advertisedUrl = card.url;
  const rpcUrl =
    explicitRpc.length > 0 ? explicitRpc : advertisedUrl;

  if (explicitRpc.length > 0) {
    process.stderr.write("Using explicit JSON-RPC URL (--rpc / A2A_RPC_URL), not card.url.\n");
  }

  process.stderr.write(
    `Agent: ${typeof card.name === "string" ? card.name : "(unknown)"} — JSON-RPC POST: ${rpcUrl}\n`
  );
  if (explicitRpc.length === 0) {
    process.stderr.write("(from agent card `url`; public path must rewrite to upstream `/.well-known/…` and `/v1`.)\n\n");
  } else {
    process.stderr.write("\n");
  }

  const rl = createInterface({ input, output });
  const authHeaders = buildAuthHeaders(card);

  let taskId = /** @type {string | null} */ (null);
  let contextId = /** @type {string | null} */ (null);
  let requestId = 0;

  try {
    let pendingText = INITIAL_USER_MESSAGE;

    while (true) {
      const id = ++requestId;
      /** @type {Record<string, unknown>} */
      const message = {
        role: "user",
        messageId: randomUUID(),
        parts: [{ kind: "text", text: pendingText }]
      };
      if (taskId) message.taskId = taskId;
      if (contextId) message.contextId = contextId;

      const rpc = await postJsonRpc(rpcUrl, {
        jsonrpc: "2.0",
        id,
        method: "message/send",
        params: { message }
      }, authHeaders);

      if (!rpc.ok) {
        process.stderr.write(`${rpc.errorText}\n`);
        process.exit(1);
      }

      const parsed = interpretSendMessageResult(rpc.data);
      if (!parsed.ok) {
        process.stderr.write(`${parsed.errorText}\n`);
        process.exit(1);
      }

      if (parsed.taskId) taskId = parsed.taskId;
      if (parsed.contextId) contextId = parsed.contextId;

      output.write(`\n--- Agent ---\n${parsed.visibleText || "(no text)"}\n`);

      if (parsed.needsInput) {
        const answer = (await rl.question("\nYour response (empty to quit): ")).trim();
        if (!answer) break;
        pendingText = answer;
        continue;
      }

      const followUp = (await rl.question("\nYour message (empty to quit): ")).trim();
      if (!followUp) break;
      pendingText = followUp;
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${String(err)}\n`);
  process.exit(1);
});
