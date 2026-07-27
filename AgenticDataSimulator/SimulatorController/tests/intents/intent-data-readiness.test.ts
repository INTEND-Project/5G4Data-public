import { describe, expect, it } from "vitest";

import { metricsExpectedForStorage } from "../../src/lib/intents/intent-data-readiness";
import type { MetricQueryMetadata } from "../../src/lib/kg/metric-query-metadata";

describe("metricsExpectedForStorage", () => {
  const metadata: MetricQueryMetadata[] = [
    {
      compoundMetric: "m1_COa",
      queryUrl: "http://127.0.0.1:9090/api/v1/query?query=x",
      backend: "prometheus",
    },
    {
      compoundMetric: "m2_COb",
      queryUrl: "http://127.0.0.1:9090/api/v1/query?query=y",
      backend: "prometheus",
    },
  ];

  it("returns prometheus-backed metrics for prometheus storage", () => {
    expect(
      metricsExpectedForStorage("prometheus", ["m1_COa", "m2_COb", "other_COc"], metadata),
    ).toEqual(["m1_COa", "m2_COb"]);
  });

  it("returns empty when catalog is empty", () => {
    expect(metricsExpectedForStorage("prometheus", [], metadata)).toEqual([]);
  });

  it("dedupes duplicate prometheus metadata rows for the same compound metric", () => {
    const duplicated: MetricQueryMetadata[] = [
      ...metadata,
      {
        compoundMetric: "m1_COa",
        queryUrl: "http://127.0.0.1:9090/api/v1/query?query=duplicate",
        backend: "prometheus",
      },
      {
        compoundMetric: "m2_COb",
        queryUrl: "http://127.0.0.1:9090/api/v1/query?query=duplicate2",
        backend: "prometheus",
      },
      {
        compoundMetric: "m2_COb",
        queryUrl: "http://127.0.0.1:9090/api/v1/query?query=duplicate3",
        backend: "prometheus",
      },
    ];

    expect(
      metricsExpectedForStorage("prometheus", ["m1_COa", "m2_COb", "m3_COc"], duplicated),
    ).toEqual(["m1_COa", "m2_COb"]);
  });
});
