import { describe, expect, it } from "vitest";

describe("mergeMetricCatalog", () => {
  it("merges, deduplicates, and sorts metric names per intent id", async () => {
    const { mergeMetricCatalog } = await import(
      "../../src/lib/dsl/analysis/extract-metric-catalog"
    );
    const catalogByIntentId = new Map<string, string[]>();

    const first = mergeMetricCatalog(catalogByIntentId, "Iabc", [
      "bandwidth_CO11111111111111111111111111111111",
      "detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
    ]);
    expect(first).toEqual([
      "bandwidth_CO11111111111111111111111111111111",
      "detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
    ]);

    const second = mergeMetricCatalog(catalogByIntentId, "Iabc", [
      "bandwidth_CO11111111111111111111111111111111",
      "p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4",
    ]);
    expect(second).toEqual([
      "bandwidth_CO11111111111111111111111111111111",
      "detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
      "p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4",
    ]);
    expect(catalogByIntentId.get("Iabc")).toEqual(second);
  });
});
