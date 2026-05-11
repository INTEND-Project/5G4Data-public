import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createSession } from "./turnOrchestrator.js";
import type { AgentCard } from "./a2a/service.js";
import type { AgentTurnResult, ChatSession } from "../models.js";

interface RuntimeApi {
  runTurn(session: ChatSession, userText: string): Promise<AgentTurnResult>;
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
}

interface TurnBody {
  userText: string;
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json; charset=utf-8" };
}

function normalizePath(path: string): string {
  if (path.startsWith("/")) return path;
  return `/${path}`;
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

export function createOpenApiSpec(
  agentCardPath: string,
  extensionPaths?: Record<string, unknown>
): Record<string, unknown> {
  const normalizedCardPath = normalizePath(agentCardPath);
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
      get: {
        operationId: "agentInfo",
        responses: {
          "200": {
            description: "Runtime metadata"
          }
        }
      }
    },
    "/v1/sessions": {
      post: {
        operationId: "createSession",
        responses: {
          "201": {
            description: "Session created"
          }
        }
      }
    },
    "/v1/sessions/{sessionId}/turns": {
      post: {
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
          }
        }
      }
    },
    [normalizedCardPath]: {
      get: {
        operationId: "getAgentCard",
        responses: {
          "200": {
            description: "A2A agent card"
          }
        }
      }
    }
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenClawAgent Control API",
      version: "1.0.0"
    },
    paths: { ...basePaths, ...(extensionPaths ?? {}) }
  };
}

export function startOpenApiServer(options: OpenApiServerOptions) {
  const sessions = new Map<string, ChatSession>();
  const openApiSpec = createOpenApiSpec(
    options.agentCardPath,
    options.runtime.getDomainPackage().controlApiExtension?.paths
  );
  const normalizedCardPath = normalizePath(options.agentCardPath);
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const path = url.pathname;
    try {
      if (method === "GET" && path === "/health") {
        response.writeHead(200, jsonHeaders());
        response.end(JSON.stringify({ status: "ok" }));
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
