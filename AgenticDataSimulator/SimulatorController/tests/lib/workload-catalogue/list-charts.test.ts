import { describe, expect, it } from "vitest";

import { normalizeWorkloadCatalogCharts } from "../../../src/lib/workload-catalogue/list-charts";

describe("normalizeWorkloadCatalogCharts", () => {
  it("normalizes array payloads", () => {
    const workloads = normalizeWorkloadCatalogCharts([
      { name: "rusty-llm", version: "0.1.19", description: "LLM workload" },
      { name: "ai-server", version: "1.0.0" },
    ]);

    expect(workloads).toEqual([
      { name: "ai-server", version: "1.0.0" },
      { name: "rusty-llm", version: "0.1.19", description: "LLM workload" },
    ]);
  });

  it("normalizes charts wrapper payloads", () => {
    const workloads = normalizeWorkloadCatalogCharts({
      charts: [{ name: "beta-chart", version: "2.0.0" }],
    });

    expect(workloads).toEqual([{ name: "beta-chart", version: "2.0.0" }]);
  });

  it("normalizes name-keyed object payloads and dedupes by chart name", () => {
    const workloads = normalizeWorkloadCatalogCharts({
      "rusty-llm": [
        { version: "0.1.18", description: "older" },
        { version: "0.1.19", description: "newer" },
      ],
      "ai-server": [{ version: "1.0.0" }],
    });

    expect(workloads).toEqual([
      { name: "ai-server", version: "1.0.0" },
      { name: "rusty-llm", version: "0.1.18", description: "older" },
    ]);
  });

  it("skips entries without a chart name", () => {
    const workloads = normalizeWorkloadCatalogCharts([
      { version: "0.1.0" },
      { name: "valid-chart" },
    ]);

    expect(workloads).toEqual([{ name: "valid-chart" }]);
  });
});
