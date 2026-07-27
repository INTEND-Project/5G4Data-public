import { describe, expect, it } from "vitest";

import {
  observationErrorsUrl,
  observationProgressUrl,
  resolveObservationControlApiBase,
} from "@/lib/observation-agent/control-api-base";
import {
  observationErrorsUrlFromAgentRpcUrl,
  observationProgressUrlFromAgentRpcUrl,
} from "@/lib/a2a/agent-control-url";

describe("resolveObservationControlApiBase", () => {
  it("uses override when set", () => {
    expect(
      resolveObservationControlApiBase(
        "https://public.example/5g4data-intent-observation-generating-agent/v1",
        "http://127.0.0.1:3012/v1",
      ),
    ).toBe("http://127.0.0.1:3012/v1");
  });

  it("normalizes rpc url without /v1", () => {
    expect(resolveObservationControlApiBase("https://host/agents/obs")).toBe(
      "https://host/agents/obs/v1",
    );
  });
});

describe("observation control URLs", () => {
  it("builds progress URL from override", () => {
    expect(
      observationProgressUrlFromAgentRpcUrl(
        "https://public.example/agent/v1",
        "http://127.0.0.1:3012/v1",
      ),
    ).toBe("http://127.0.0.1:3012/v1/observation-progress");
  });

  it("builds errors URL from rpc base", () => {
    expect(observationErrorsUrl("https://host/agents/obs/v1")).toBe(
      "https://host/agents/obs/v1/observation-errors",
    );
  });

  it("builds progress URL when rpc ends with /v1", () => {
    expect(observationProgressUrl("https://host/agents/obs/v1")).toBe(
      "https://host/agents/obs/v1/observation-progress",
    );
  });
});
