import { describe, expect, it } from "vitest";

import {
  observationErrorsUrlFromAgentRpcUrl,
  workloadPreviewUrlFromAgentRpcUrl,
} from "../../src/lib/a2a/agent-control-url";

describe("workloadPreviewUrlFromAgentRpcUrl", () => {
  it("appends control path when rpc url ends with /v1", () => {
    expect(workloadPreviewUrlFromAgentRpcUrl("https://host/agents/intent/v1")).toBe(
      "https://host/agents/intent/v1/control/workload-preview",
    );
  });

  it("inserts /v1 when rpc url has no version suffix", () => {
    expect(workloadPreviewUrlFromAgentRpcUrl("https://host/agents/intent")).toBe(
      "https://host/agents/intent/v1/control/workload-preview",
    );
  });
});

describe("observationErrorsUrlFromAgentRpcUrl", () => {
  it("appends observation-errors path when rpc url ends with /v1", () => {
    expect(observationErrorsUrlFromAgentRpcUrl("https://host/agents/obs/v1")).toBe(
      "https://host/agents/obs/v1/observation-errors",
    );
  });

  it("inserts /v1 when rpc url has no version suffix", () => {
    expect(observationErrorsUrlFromAgentRpcUrl("https://host/agents/obs")).toBe(
      "https://host/agents/obs/v1/observation-errors",
    );
  });
});
