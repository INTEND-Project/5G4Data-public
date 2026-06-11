import { describe, expect, it } from "vitest";

import { interpretSendMessageResult } from "@/lib/a2a/interpret-message-result";

describe("interpretSendMessageResult", () => {
  it("reads openclaw trace ids from task metadata", () => {
    const parsed = interpretSendMessageResult({
      jsonrpc: "2.0",
      id: "1",
      result: {
        kind: "task",
        id: "task-1",
        contextId: "ctx-1",
        status: { state: "completed" },
        artifacts: [{ parts: [{ kind: "text", text: "@prefix icm: <x#> ." }] }],
        metadata: {
          openclaw: {
            agentTraceVersion: "1",
            turnId: "turn-123",
            mlflowTraceId: "tr-456",
          },
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.turnId).toBe("turn-123");
    expect(parsed.mlflowTraceId).toBe("tr-456");
  });
});
