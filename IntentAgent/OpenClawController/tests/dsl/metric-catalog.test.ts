import { describe, expect, it } from "vitest";

describe("metric catalog extraction", () => {
  it("derives script-facing metric names by stripping _CO suffixes", async () => {
    const metricCatalogModule = await import(
      "../../src/lib/dsl/analysis/extract-metric-catalog"
    );

    const catalog = metricCatalogModule.extractMetricCatalog([
      "detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
      "bandwidth_CO87a0d8360e3f46519672120b93aac41e",
      "bandwidth_CO11111111111111111111111111111111",
      "kepler_container_cpu_watts_COd868fdf91806431f82f48c25c0482b4a",
      "plainMetric",
    ]);

    expect(catalog).toEqual([
      "detection-latency",
      "bandwidth",
      "kepler_container_cpu_watts",
      "plainMetric",
    ]);
  });
});
