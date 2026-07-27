import { describe, expect, it } from "vitest";

import {
  humanizeObservationAgentError,
  toObservationSetupError,
} from "../../src/lib/observation-agent/observation-agent-error-display";

describe("observation agent error display", () => {
  it("humanizes prometheus remote write flush failures", () => {
    const message = humanizeObservationAgentError({
      schemaVersion: "observation_error_v1",
      timestampUtc: new Date().toISOString(),
      kind: "prometheus_remote_write_flush_failed",
      message: "prometheus remote write failed: TypeError: fetch failed",
      metric: "detection-latency",
      sampleCount: 2881,
      remoteWriteUrl: "http://host.docker.internal:9090/api/v1/write",
    });

    expect(message).toContain("Prometheus was unreachable");
    expect(message).toContain("2,881 samples");
    expect(message).toContain("host.docker.internal:9090");
    expect(message).toContain("Prometheus && ./start.sh");
  });

  it("maps agent errors to setup errors with humanized messages", () => {
    const setupError = toObservationSetupError({
      schemaVersion: "observation_error_v1",
      timestampUtc: new Date().toISOString(),
      kind: "synthetic_worker_exit",
      message: "prometheus remote write failed: TypeError: fetch failed",
      metric: "detection-latency",
      exitCode: 1,
    });

    expect(setupError.kind).toBe("synthetic_worker_exit");
    expect(setupError.message).toContain("Prometheus");
    expect(setupError.metric).toBe("detection-latency");
  });
});
