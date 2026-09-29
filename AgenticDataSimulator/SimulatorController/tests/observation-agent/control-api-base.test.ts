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
  it("ignores bare localhost override when card URL is a public host", () => {
    expect(
      resolveObservationControlApiBase(
        "https://public.example/5g4data-intent-observation-schema-synth-agent/v1",
        "http://127.0.0.1:3012/v1",
      ),
    ).toBe("https://public.example/5g4data-intent-observation-schema-synth-agent/v1");
  });

  it("uses localhost override when rpc URL is also loopback", () => {
    expect(
      resolveObservationControlApiBase(
        "http://127.0.0.1:3015/v1",
        "http://127.0.0.1:3015/v1",
      ),
    ).toBe("http://127.0.0.1:3015/v1");
  });

  it("uses override that includes an agent path slug", () => {
    expect(
      resolveObservationControlApiBase(
        "https://public.example/5g4data-intent-observation-schema-synth-agent/v1",
        "https://public.example/5g4data-intent-observation-schema-synth-agent/v1",
      ),
    ).toBe("https://public.example/5g4data-intent-observation-schema-synth-agent/v1");
  });

  it("normalizes rpc url without /v1", () => {
    expect(resolveObservationControlApiBase("https://host/agents/obs")).toBe(
      "https://host/agents/obs/v1",
    );
  });
});

describe("observation control URLs", () => {
  it("builds progress URL from discovered agent when localhost override would mismatch", () => {
    expect(
      observationProgressUrlFromAgentRpcUrl(
        "https://public.example/5g4data-intent-observation-schema-synth-agent/v1",
        "http://127.0.0.1:3012/v1",
      ),
    ).toBe(
      "https://public.example/5g4data-intent-observation-schema-synth-agent/v1/observation-progress",
    );
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
