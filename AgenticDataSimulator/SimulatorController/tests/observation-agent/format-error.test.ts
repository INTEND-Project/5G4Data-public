import { describe, expect, it } from "vitest";

import {
  formatObservationAgentErrorMessage,
  observationAgentErrorKey,
} from "../../src/lib/observation-agent/format-error";

describe("formatObservationAgentErrorMessage", () => {
  it("includes metric and sample count when present", () => {
    const message = formatObservationAgentErrorMessage({
      schemaVersion: "observation_error_v1",
      timestampUtc: "2026-06-01T12:00:00.000Z",
      kind: "prometheus_remote_write_flush_failed",
      message: "HTTP 502",
      metric: "p99-token-target_COee91f",
      sampleCount: 1441,
    });
    expect(message).toContain("p99-token-target_COee91f");
    expect(message).toContain("1441 samples");
    expect(message).toContain("HTTP 502");
  });
});

describe("observationAgentErrorKey", () => {
  it("deduplicates identical entries", () => {
    const entry = {
      schemaVersion: "observation_error_v1" as const,
      timestampUtc: "2026-06-01T12:00:00.000Z",
      kind: "synthetic_worker_exit",
      message: "exit 1",
    };
    expect(observationAgentErrorKey(entry)).toBe(observationAgentErrorKey(entry));
  });
});
