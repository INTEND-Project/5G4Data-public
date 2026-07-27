import { describe, expect, it } from "vitest";

import {
  agentInfoUrlFromAgentRpcUrl,
  workloadPreviewUrlFromAgentRpcUrl,
} from "@/lib/a2a/agent-control-url";

describe("agentInfoUrlFromAgentRpcUrl", () => {
  it("appends agent/info to /v1 rpc base", () => {
    expect(agentInfoUrlFromAgentRpcUrl("http://127.0.0.1:8787/v1")).toBe(
      "http://127.0.0.1:8787/v1/agent/info",
    );
  });

  it("inserts /v1 when rpc base has no version suffix", () => {
    expect(agentInfoUrlFromAgentRpcUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/v1/agent/info",
    );
  });

  it("strips trailing slashes on rpc base", () => {
    expect(agentInfoUrlFromAgentRpcUrl("http://127.0.0.1:8787/v1/")).toBe(
      "http://127.0.0.1:8787/v1/agent/info",
    );
    expect(workloadPreviewUrlFromAgentRpcUrl("http://127.0.0.1:8787/v1/")).toBe(
      "http://127.0.0.1:8787/v1/control/workload-preview",
    );
  });
});
