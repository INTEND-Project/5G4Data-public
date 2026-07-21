import test from "node:test";
import assert from "node:assert/strict";
import { formatMetricSummaryLine } from "../tools/objectiveSummaryFormat.js";
import { WorkloadCatalogueTool } from "../tools/catalogueTool.js";

test("formatMetricSummaryLine emits all tmf hint fields", () => {
  const line = formatMetricSummaryLine({
    name: "p99-token-target",
    value: 0.0,
    "tmf-value-hint": "400",
    "tmf-quantifier-hint": "quan:larger",
    "tmf-unit-hint": "token/s",
    measuredBy: "intend/p99token"
  });
  assert.equal(
    line,
    "- p99-token-target: threshold=400 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=token/s (source=tmf-unit-hint), measuredBy=intend/p99token"
  );
});

test("formatMetricSummaryLine falls back to value and omits absent hints", () => {
  const line = formatMetricSummaryLine({
    name: "latency-target",
    value: "25"
  });
  assert.equal(line, "- latency-target: threshold=25 (source=value)");
});

test("formatMetricSummaryLine includes sustainability hints", () => {
  const line = formatMetricSummaryLine({
    name: "energy-consumption",
    value: "50",
    "tmf-value-hint": "50",
    "tmf-quantifier-hint": "quan:larger",
    "tmf-unit-hint": "J",
    measuredBy: "intend/energy-consumption"
  });
  assert.match(line, /threshold=50 \(source=tmf-value-hint\)/);
  assert.match(line, /quantifier=quan:larger \(source=tmf-quantifier-hint\)/);
  assert.match(line, /unit=J \(source=tmf-unit-hint\)/);
  assert.match(line, /measuredBy=intend\/energy-consumption/);
});

test("metricsForChart returns structured objectives and sustainability", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/charts/rusty-llm")) {
      return new Response(
        JSON.stringify([
          {
            version: "0.1.19",
            values: {
              objectives: [
                {
                  name: "p99-token-target",
                  "tmf-value-hint": "400",
                  measuredBy: "intend/p99token",
                },
              ],
              sustainability: [
                {
                  name: "energy-consumption",
                  "tmf-value-hint": "50",
                  measuredBy: "intend/energy-consumption",
                },
              ],
            },
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tool = new WorkloadCatalogueTool("https://catalog.example");
    const metrics = await tool.metricsForChart("rusty-llm");
    assert.ok(metrics);
    assert.equal(metrics.chartName, "rusty-llm");
    assert.equal(metrics.version, "0.1.19");
    assert.equal(metrics.objectives[0]?.name, "p99-token-target");
    assert.equal(metrics.sustainability[0]?.name, "energy-consumption");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
