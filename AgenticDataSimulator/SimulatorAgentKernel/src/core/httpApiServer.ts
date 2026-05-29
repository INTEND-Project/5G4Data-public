import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { A2AJsonRpcAdapter } from "./a2a/jsonRpcAdapter.js";
import {
  isAuthorizedRequest,
  resolveAgentAuthConfig,
  unauthorizedResponse,
  type AgentAuthConfig
} from "./a2a/auth.js";
import { createSession } from "./turnOrchestrator.js";
import type { AgentCard } from "./a2a/service.js";
import type { AgentTurnResult, ChatSession } from "../models.js";

interface RuntimeApi {
  runTurn(session: ChatSession, userText: string): Promise<AgentTurnResult>;
  resolveWorkloadPreview?(
    prompt: string,
    graphTargetBinding?: import("../models.js").GraphTargetBinding | null
  ): Promise<import("./capabilityRouter.js").WorkloadPreviewResult>;
  getDomainPackage(): {
    manifest: { name: string; version: string };
    controlApiExtension?: { paths?: Record<string, unknown> };
    intentBindingMetadata?: unknown;
  };
  getAppConfig(): { openClawModel: string };
}

interface OpenApiServerOptions {
  runtime: RuntimeApi;
  host: string;
  port: number;
  agentCardPath: string;
  agentCard: AgentCard;
  agentApiKey?: string;
  agentApiKeyHeader?: string;
}

interface TurnBody {
  userText: string;
}

interface WorkloadPreviewBody {
  prompt: string;
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json; charset=utf-8" };
}

function normalizePath(path: string): string {
  if (path.startsWith("/")) return path;
  return `/${path}`;
}

/** Same path normalization for inbound requests and advertised routes (trailing slashes optional). */
function normalizeHttpPath(pathname: string): string {
  let p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (p.length > 1) {
    p = p.replace(/\/+$/, "");
  }
  return p;
}

async function readJsonBody<T>(request: AsyncIterable<Uint8Array>): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    throw new Error("Request body is required.");
  }
  return JSON.parse(text) as T;
}

async function readUtf8Body(request: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pathnameFromAbsoluteUrl(candidate: string): string {
  try {
    const pathname = new URL(candidate).pathname;
    return pathname.length > 0 ? pathname : "/v1";
  } catch {
    return "/v1";
  }
}

/** Path-bound on this process’ HTTP listener. `agentCard.url` is an absolute discovery URL whose pathname often includes reverse-proxy prefixes; stripping upstream makes inbound JSON-RPC **`/v1`**, so bind RPC there whenever the pathname’s last segment is `v1`. */
function internalJsonRpcListenPath(advertisedRpcUrl: string): string {
  const pathname = pathnameFromAbsoluteUrl(advertisedRpcUrl);
  const normalized = normalizeHttpPath(pathname);
  const segments = normalized.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (last === "v1") return normalizeHttpPath("/v1");
  return normalized;
}

export function createOpenApiSpec(
  agentCardPath: string,
  a2aRpcPath: string,
  extensionPaths?: Record<string, unknown>,
  auth?: AgentAuthConfig | null
): Record<string, unknown> {
  const normalizedCardPath = normalizeHttpPath(normalizePath(agentCardPath));
  const normalizedRpcPath = normalizeHttpPath(normalizePath(a2aRpcPath));
  const protectedSecurity = auth?.enabled
    ? [{ [auth.schemeName]: [] }]
    : undefined;
  const withSecurity = <T extends Record<string, unknown>>(operation: T): T =>
    protectedSecurity ? { ...operation, security: protectedSecurity } : operation;

  const basePaths: Record<string, unknown> = {
    "/health": {
      get: {
        operationId: "health",
        responses: {
          "200": {
            description: "Health response"
          }
        }
      }
    },
    "/v1/agent/info": {
      get: withSecurity({
        operationId: "agentInfo",
        responses: {
          "200": {
            description: "Runtime metadata"
          },
          "401": {
            description: "Missing or invalid API key"
          }
        }
      })
    },
    "/v1/sessions": {
      post: withSecurity({
        operationId: "createSession",
        responses: {
          "201": {
            description: "Session created"
          },
          "401": {
            description: "Missing or invalid API key"
          }
        }
      })
    },
    "/v1/sessions/{sessionId}/turns": {
      post: withSecurity({
        operationId: "runTurn",
        parameters: [{ name: "sessionId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["userText"],
                properties: {
                  userText: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Turn output"
          },
          "401": {
            description: "Missing or invalid API key"
          }
        }
      })
    },
    [normalizedRpcPath]: {
      post: withSecurity({
        operationId: "a2aJsonRpc",
        responses: {
          "200": {
            description:
              "A2A JSON-RPC 2.0 (v0.3-style message/send mapped to OpenClaw turn execution)"
          },
          "401": {
            description: "Missing or invalid API key"
          }
        }
      })
    },
    [normalizedCardPath]: {
      get: withSecurity({
        operationId: "getAgentCard",
        responses: {
          "200": {
            description: "A2A agent card"
          },
          "401": {
            description: "Missing or invalid API key"
          }
        }
      })
    }
  };
  const spec: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: "SimulatorAgentKernel Control API",
      version: "1.0.0"
    },
    paths: { ...basePaths, ...(extensionPaths ?? {}) }
  };
  if (auth?.enabled) {
    spec.components = {
      securitySchemes: auth.securitySchemes
    };
    spec.security = [{ [auth.schemeName]: [] }];
  }
  return spec;
}

function writeUnauthorized(response: ServerResponse, auth: AgentAuthConfig): void {
  const payload = unauthorizedResponse(auth.schemeName, auth.headerName);
  response.writeHead(payload.status, payload.headers);
  response.end(payload.body);
}

function rejectUnlessAuthorized(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  auth: AgentAuthConfig | null
): boolean {
  if (!auth?.enabled) return true;
  if (
    isAuthorizedRequest(
      auth,
      request.headers,
      url.searchParams,
      request.headers.cookie
    )
  ) {
    return true;
  }
  writeUnauthorized(response, auth);
  return false;
}

export function startOpenApiServer(options: OpenApiServerOptions) {
  const sessions = new Map<string, ChatSession>();
  const a2aRpcPath = internalJsonRpcListenPath(options.agentCard.url);
  const auth = resolveAgentAuthConfig(options.agentApiKey, options.agentApiKeyHeader);
  if (!auth?.enabled) {
    process.stderr.write(
      "[API] AGENT_API_KEY is not set; inbound agent HTTP endpoints are unauthenticated.\n"
    );
  }
  const openApiSpec = createOpenApiSpec(
    options.agentCardPath,
    a2aRpcPath,
    options.runtime.getDomainPackage().controlApiExtension?.paths,
    auth
  );
  const normalizedCardPath = normalizeHttpPath(normalizePath(options.agentCardPath));
  const normalizedA2ARpcPath = normalizeHttpPath(normalizePath(a2aRpcPath));
  const a2aAdapter = new A2AJsonRpcAdapter({
    runTurn(session, userText) {
      return options.runtime.runTurn(session, userText);
    }
  });

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const path = normalizeHttpPath(url.pathname);
    try {
      if (method === "GET" && path === "/health") {
        response.writeHead(200, jsonHeaders());
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (!rejectUnlessAuthorized(request, response, url, auth)) {
        return;
      }

      if (method === "GET" && path === "/v1/agent/info") {
        const manifest = options.runtime.getDomainPackage().manifest;
        response.writeHead(200, jsonHeaders());
        response.end(
          JSON.stringify({
            packageName: manifest.name,
            packageVersion: manifest.version,
            model: options.runtime.getAppConfig().openClawModel,
            intentBindingMetadata: options.runtime.getDomainPackage().intentBindingMetadata ?? null
          })
        );
        return;
      }

      if (method === "GET" && path === "/openapi.json") {
        response.writeHead(200, jsonHeaders());
        response.end(JSON.stringify(openApiSpec));
        return;
      }

      if (method === "GET" && path === normalizedCardPath) {
        response.writeHead(200, jsonHeaders());
        response.end(JSON.stringify(options.agentCard));
        return;
      }

      if (method === "POST" && path === normalizedA2ARpcPath) {
        const rawBody = await readUtf8Body(request);
        const rpc = await a2aAdapter.handleRawBodyAsync(rawBody);
        response.writeHead(rpc.httpStatus, jsonHeaders());
        response.end(rpc.body);
        return;
      }

      if (method === "POST" && path === "/v1/sessions") {
        const session = createSession();
        sessions.set(session.sessionId, session);
        response.writeHead(201, jsonHeaders());
        response.end(JSON.stringify({ sessionId: session.sessionId, createdAt: session.createdAt }));
        return;
      }

      const turnMatch = /^\/v1\/sessions\/([^/]+)\/turns$/.exec(path);
      if (method === "POST" && turnMatch?.[1]) {
        const sessionId = decodeURIComponent(turnMatch[1]);
        const session = sessions.get(sessionId);
        if (!session) {
          response.writeHead(404, jsonHeaders());
          response.end(JSON.stringify({ error: "Session not found." }));
          return;
        }
        const body = await readJsonBody<TurnBody>(request);
        if (!body.userText || !body.userText.trim()) {
          response.writeHead(400, jsonHeaders());
          response.end(JSON.stringify({ error: "userText is required." }));
          return;
        }
        const result = await options.runtime.runTurn(session, body.userText);
        response.writeHead(200, jsonHeaders());
        response.end(JSON.stringify(result));
        return;
      }

      if (method === "POST" && path === "/v1/control/workload-preview") {
        if (typeof options.runtime.resolveWorkloadPreview !== "function") {
          response.writeHead(501, jsonHeaders());
          response.end(
            JSON.stringify({
              error: "Workload preview is not supported by this agent runtime.",
            })
          );
          return;
        }
        const body = await readJsonBody<WorkloadPreviewBody>(request);
        if (!body.prompt || !body.prompt.trim()) {
          response.writeHead(400, jsonHeaders());
          response.end(JSON.stringify({ error: "prompt is required." }));
          return;
        }
        const preview = await options.runtime.resolveWorkloadPreview(body.prompt.trim());
        response.writeHead(200, jsonHeaders());
        response.end(JSON.stringify(preview));
        return;
      }

      response.writeHead(404, jsonHeaders());
      response.end(JSON.stringify({ error: "Not found." }));
    } catch (error) {
      response.writeHead(500, jsonHeaders());
      response.end(JSON.stringify({ error: String(error) }));
    }
  });

  return {
    listen: async () =>
      new Promise<{ host: string; port: number }>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          server.off("error", reject);
          const address = server.address() as AddressInfo | null;
          resolve({
            host: address?.address ?? options.host,
            port: address?.port ?? options.port
          });
        });
      }),
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      })
  };
}
