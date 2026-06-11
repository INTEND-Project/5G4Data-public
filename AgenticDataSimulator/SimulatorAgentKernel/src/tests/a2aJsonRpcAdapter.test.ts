import test from "node:test";
import assert from "node:assert/strict";
import { A2AJsonRpcAdapter, extractTextFromParts } from "../core/a2a/jsonRpcAdapter.js";
import type { ChatSession } from "../models.js";

test("extractTextFromParts merges text parts", () => {
  assert.equal(extractTextFromParts(null), "");
  assert.equal(
    extractTextFromParts([
      { kind: "text", text: "a" },
      { kind: "text", text: "b" }
    ]),
    "a\nb"
  );
});

test("A2A message/send returns completed task + artifact", async () => {
  const adapter = new A2AJsonRpcAdapter({
    async runTurn() {
      return { response: "done", warnings: [], debug: [] };
    }
  });
  const res = await adapter.handleRawBodyAsync(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "r1",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: "ping" }]
        }
      }
    })
  );
  assert.equal(res.httpStatus, 200);
  const body = JSON.parse(res.body) as {
    jsonrpc?: string;
    id?: unknown;
    result?: { kind: string; status: { state: string }; artifacts: { parts: { text: string }[] }[] };
    error?: unknown;
  };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, "r1");
  assert.ifError(body.error);
  assert.equal(body.result?.kind, "task");
  assert.equal(body.result?.status?.state, "completed");
  assert.equal(body.result?.artifacts?.[0]?.parts?.[0]?.text, "done");
});

test("A2A message/send includes openclaw trace metadata when turn provides ids", async () => {
  const adapter = new A2AJsonRpcAdapter({
    async runTurn() {
      return {
        response: "done",
        warnings: [],
        debug: [],
        turnId: "turn-abc",
        mlflowTraceId: "tr-xyz"
      };
    }
  });
  const res = await adapter.handleRawBodyAsync(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "trace-1",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: "ping" }]
        }
      }
    })
  );
  const body = JSON.parse(res.body) as {
    result?: {
      metadata?: { openclaw?: { turnId?: string; mlflowTraceId?: string } };
    };
  };
  assert.equal(body.result?.metadata?.openclaw?.turnId, "turn-abc");
  assert.equal(body.result?.metadata?.openclaw?.mlflowTraceId, "tr-xyz");
});

test("SendMessage alias and multi-turn binds same ChatSession", async () => {
  const sessionsSeen: ChatSession[] = [];
  const adapter = new A2AJsonRpcAdapter({
    async runTurn(session, userText) {
      sessionsSeen.push(session);
      return { response: `echo:${userText}`, warnings: [], debug: [] };
    }
  });
  const first = await adapter.handleRawBodyAsync(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: "one" }]
        }
      }
    })
  );
  const firstBody = JSON.parse(first.body) as { result?: { id: string } };
  const taskId = firstBody.result?.id;
  assert.ok(taskId?.length);

  const second = await adapter.handleRawBodyAsync(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "message/send",
      params: {
        message: {
          role: "user",
          taskId,
          parts: [{ kind: "text", text: "two" }]
        }
      }
    })
  );
  const secondBody = JSON.parse(second.body) as {
    result?: { artifacts?: { parts: { text?: string }[] }[] };
  };
  assert.equal(secondBody.result?.artifacts?.[0]?.parts?.[0]?.text, "echo:two");
  assert.equal(sessionsSeen.length, 2);
  assert.strictEqual(sessionsSeen[0], sessionsSeen[1]);
});

test("message/send metadata.openclaw.graphTarget binds ChatSession", async () => {
  let boundSession: ChatSession | undefined;
  const adapter = new A2AJsonRpcAdapter({
    async runTurn(session) {
      boundSession = session;
      return { response: "ok", warnings: [], debug: [] };
    },
  });
  const res = await adapter.handleRawBodyAsync(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "bind-1",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: "observe" }],
          metadata: {
            openclaw: {
              controllerBindingVersion: "1",
              graphTarget: {
                repositoryId: "repo-bind",
                graphIri: "urn:intend:kg:bind",
                sparqlEndpoint: "http://gdb/repositories/repo-bind/sparql",
                repositoryBaseUrl: "http://gdb/repositories/repo-bind",
              },
            },
          },
        },
      },
    }),
  );
  assert.equal(res.httpStatus, 200);
  const body = JSON.parse(res.body) as { error?: unknown };
  assert.ifError(body.error);
  assert.equal(boundSession?.graphTargetBinding?.repositoryId, "repo-bind");
  assert.equal(boundSession?.graphTargetBinding?.graphIri, "urn:intend:kg:bind");
});

test("conflicting graphTarget on same taskId returns JSON-RPC error", async () => {
  const adapter = new A2AJsonRpcAdapter({
    async runTurn() {
      return { response: "ok", warnings: [], debug: [] };
    },
  });
  const first = await adapter.handleRawBodyAsync(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: "one" }],
          metadata: {
            openclaw: {
              controllerBindingVersion: "1",
              graphTarget: {
                repositoryId: "repo-a",
                graphIri: "urn:g:a",
                sparqlEndpoint: "http://gdb/repositories/repo-a/sparql",
              },
            },
          },
        },
      },
    }),
  );
  const taskId = (JSON.parse(first.body) as { result?: { id: string } }).result?.id;
  assert.ok(taskId);

  const second = await adapter.handleRawBodyAsync(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "message/send",
      params: {
        message: {
          role: "user",
          taskId,
          parts: [{ kind: "text", text: "two" }],
          metadata: {
            openclaw: {
              controllerBindingVersion: "1",
              graphTarget: {
                repositoryId: "repo-b",
                graphIri: "urn:g:b",
                sparqlEndpoint: "http://gdb/repositories/repo-b/sparql",
              },
            },
          },
        },
      },
    }),
  );
  const secondBody = JSON.parse(second.body) as { error?: { code: number } };
  assert.equal(secondBody.error?.code, -32602);
});

test("unknown JSON-RPC method returns -32601", async () => {
  const adapter = new A2AJsonRpcAdapter({
    async runTurn() {
      return { response: "x", warnings: [], debug: [] };
    }
  });
  const res = await adapter.handleRawBodyAsync(
    JSON.stringify({ jsonrpc: "2.0", id: 9, method: "message/stream", params: {} })
  );
  const body = JSON.parse(res.body) as { error?: { code: number } };
  assert.equal(body.error?.code, -32601);
});
