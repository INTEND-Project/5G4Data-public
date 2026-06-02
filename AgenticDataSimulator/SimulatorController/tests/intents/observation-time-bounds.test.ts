import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveObservationTimeBounds } from "../../src/lib/intents/observation-time-bounds";

const originalEnv = { ...process.env };

vi.mock("../../src/lib/graphdb/client", () => ({
  runRepositorySparqlSelect: vi.fn(),
}));

import { runRepositorySparqlSelect } from "../../src/lib/graphdb/client";

const sparqlMock = vi.mocked(runRepositorySparqlSelect);

describe("resolveObservationTimeBounds", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: "file:./dev.db",
      A2A_REGISTRY_BASE_URL: "https://registry.example",
      GRAPHDB_BASE_URL: "http://graphdb.example/",
      PROMETHEUS_URL: "http://127.0.0.1:9090/",
      PUSHGATEWAY_URL: "http://pushgateway.example:9091",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    process.env = originalEnv;
  });

  it("uses Prometheus bounds when metadata points at Prometheus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            result: [
              {
                values: [
                  [1_770_000_000, "1"],
                  [1_770_086_400, "2"],
                ],
              },
            ],
          },
        }),
      }),
    );
    sparqlMock.mockResolvedValue([]);

    const bounds = await resolveObservationTimeBounds({
      intentId: "I743f3eed55644d95a52c2b1676fd6dd9",
      repositoryId: "repo",
      graphIri: "urn:example:graph",
      compoundMetrics: ["metric_COabc"],
      metricMetadata: [
        {
          compoundMetric: "metric_COabc",
          queryUrl: "http://127.0.0.1:9090/api/v1/query?query=metric",
          backend: "prometheus",
        },
      ],
    });

    expect(bounds).toEqual({
      minMs: 1_770_000_000_000,
      maxMs: 1_770_086_400_000,
    });
    expect(sparqlMock).not.toHaveBeenCalled();
  });

  it("uses GraphDB bounds when metadata points at GraphDB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { result: [] } }),
      }),
    );
    sparqlMock.mockResolvedValue([
      {
        minAt: { value: "2026-05-21T05:00:00Z" },
        maxAt: { value: "2026-05-22T05:00:00Z" },
      },
    ]);

    const bounds = await resolveObservationTimeBounds({
      intentId: "I743f3eed55644d95a52c2b1676fd6dd9",
      repositoryId: "repo",
      graphIri: "urn:example:graph",
      compoundMetrics: ["metric_COabc"],
      metricMetadata: [
        {
          compoundMetric: "metric_COabc",
          queryUrl: "https://example/graphdb/repositories/repo?query=SELECT",
          backend: "graphdb",
        },
      ],
    });

    expect(bounds?.minMs).toBe(Date.parse("2026-05-21T05:00:00Z"));
    expect(bounds?.maxMs).toBe(Date.parse("2026-05-22T05:00:00Z"));
    expect(sparqlMock).toHaveBeenCalledOnce();
  });
});
