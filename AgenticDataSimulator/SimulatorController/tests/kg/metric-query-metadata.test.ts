import { describe, expect, it } from "vitest";

import {
  classifyMetricQueryUrl,
  compoundMetricsForBackend,
  dedupeMetricQueryMetadata,
  resolveObservationStorageFromMetadata,
} from "../../src/lib/kg/metric-query-metadata";

describe("classifyMetricQueryUrl", () => {
  it("detects Prometheus instant query URLs", () => {
    expect(
      classifyMetricQueryUrl(
        "http://127.0.0.1:9090/api/v1/query?query=p99tokentarget%7Bintent_id%3D%22Iabc%22%7D",
      ),
    ).toBe("prometheus");
  });

  it("detects GraphDB SPARQL query URLs", () => {
    expect(
      classifyMetricQueryUrl(
        "https://start5g-1.cs.uit.no/graphdb/repositories/repo?query=SELECT%20%3Fvalue",
      ),
    ).toBe("graphdb");
  });
});

describe("dedupeMetricQueryMetadata", () => {
  it("keeps one entry per compound metric when hasQuery was inserted multiple times", () => {
    const metadata = [
      {
        compoundMetric: "p99-token-target_COabc",
        queryUrl: "http://127.0.0.1:9090/api/v1/query?query=a",
        backend: "prometheus" as const,
      },
      {
        compoundMetric: "p99-token-target_COabc",
        queryUrl: "http://127.0.0.1:9090/api/v1/query?query=b",
        backend: "prometheus" as const,
      },
      {
        compoundMetric: "energy-consumption_COdef",
        queryUrl: "http://127.0.0.1:9090/api/v1/query?query=c",
        backend: "prometheus" as const,
      },
    ];

    expect(dedupeMetricQueryMetadata(metadata)).toHaveLength(2);
    expect(compoundMetricsForBackend(metadata, "prometheus")).toEqual([
      "p99-token-target_COabc",
      "energy-consumption_COdef",
    ]);
  });
});

describe("resolveObservationStorageFromMetadata", () => {
  it("uses prometheus when all metadata queries are Prometheus", () => {
    expect(
      resolveObservationStorageFromMetadata(
        [
          {
            compoundMetric: "metric_COabc",
            queryUrl: "http://127.0.0.1:9090/api/v1/query?query=up",
            backend: "prometheus",
          },
        ],
        false,
      ),
    ).toBe("prometheus");
  });

  it("uses graphdb when all metadata queries are GraphDB", () => {
    expect(
      resolveObservationStorageFromMetadata(
        [
          {
            compoundMetric: "metric_COabc",
            queryUrl: "https://example/graphdb/repositories/repo?query=SELECT",
            backend: "graphdb",
          },
        ],
        true,
      ),
    ).toBe("graphdb");
  });

  it("falls back to prometheus membership when metadata is missing", () => {
    expect(resolveObservationStorageFromMetadata([], true)).toBe("prometheus");
    expect(resolveObservationStorageFromMetadata([], false)).toBe("graphdb");
  });
});
