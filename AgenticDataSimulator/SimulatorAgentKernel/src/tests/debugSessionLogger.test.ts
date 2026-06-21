import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startOpenApiServer } from "../core/httpApiServer.js";
import type { AgentCard } from "../core/a2a/service.js";

test("OpenAPI server appends debug log on HTTP turns when apiDebug is enabled", async () => {
  const logsDir = mkdtempSync(join(tmpdir(), "api-debug-log-"));
  const previousCwd = process.cwd();
  process.chdir(logsDir);
  const debugLogPath = "logs/openclaw-agent-debug.jsonl";

  const runtime = {
    async runTurn(
      _session: unknown,
      userText: string,
      hooks?: { replHookDebug?: boolean; replHookDebugLogPath?: string }
    ) {
      assert.equal(hooks?.replHookDebug, true);
      assert.equal(hooks?.replHookDebugLogPath, debugLogPath);
      return {
        response: `echo:${userText}`,
        warnings: [],
        debug: ["test"]
      };
    },
    getDomainPackage() {
      return { manifest: { name: "demo", version: "0.1.0" } };
    },
    getAppConfig() {
      return { openClawModel: "demo-model" };
    }
  };
  const agentCard: AgentCard = {
    protocolVersion: "0.3.0",
    name: "demo",
    description: "demo",
    url: "http://localhost/v1",
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: []
  };
  const server = startOpenApiServer({
    runtime,
    host: "127.0.0.1",
    port: 0,
    agentCardPath: "/.well-known/agent-card.json",
    agentCard,
    apiDebug: {
      enabled: true,
      debugLogPath,
      writeIntentTurtleDebugFile: false
    }
  });

  try {
    const address = await server.listen();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sessionRes = await fetch(`${baseUrl}/v1/sessions`, { method: "POST" });
    const session = (await sessionRes.json()) as { sessionId: string };
    const turnRes = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userText: "hello" })
    });
    assert.equal(turnRes.status, 200);

    const logText = readFileSync(join(logsDir, debugLogPath), "utf8");
    const entry = JSON.parse(logText.trim()) as {
      userText: string;
      assistantResponse: string;
      sessionId: string;
    };
    assert.equal(entry.userText, "hello");
    assert.equal(entry.assistantResponse, "echo:hello");
    assert.equal(entry.sessionId, session.sessionId);
  } finally {
    await server.close();
    process.chdir(previousCwd);
    rmSync(logsDir, { recursive: true, force: true });
  }
});
