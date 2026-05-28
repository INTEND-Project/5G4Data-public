import { describe, expect, it } from "vitest";

import {
  buildGrafanaTimeParams,
  buildIntentGrafanaUrl,
} from "../../src/lib/grafana/intent-dashboard-url";
import { resolveObservationStorageFromMetadata } from "../../src/lib/kg/metric-query-metadata";
import {
  historicGrafanaWindow,
  isStreamingBounds,
} from "../../src/lib/intents/observation-time-bounds";
import { buildClearIntentObservationsUpdate } from "../../src/lib/intents/clear-intent-observations-query";

describe("resolveObservationStorageFromMetadata", () => {
  it("derives prometheus from intent-reports-metadata PromQL URLs", () => {
    expect(
      resolveObservationStorageFromMetadata(
        [
          {
            compoundMetric: "p99-token-target_COabc",
            queryUrl: "http://127.0.0.1:9090/api/v1/query?query=metric",
            backend: "prometheus",
          },
        ],
        false,
      ),
    ).toBe("prometheus");
  });

  it("falls back to prometheus label membership when metadata is absent", () => {
    expect(resolveObservationStorageFromMetadata([], true)).toBe("prometheus");
    expect(resolveObservationStorageFromMetadata([], false)).toBe("graphdb");
  });
});

describe("intent-dashboard-url", () => {
  it("builds streaming grafana url when bounds are recent", () => {
    const now = Date.now();
    const url = buildIntentGrafanaUrl({
      intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
      conditionMetrics: ["metric_COabc"],
      bounds: { minMs: now - 60_000, maxMs: now - 30_000 },
      env: {
        baseUrl: "http://grafana.example:3001",
        dashboardUid: "abc123",
        dashboardSlug: "intent-dashboard",
      },
    });

    expect(url).toContain("http://grafana.example:3001/d/abc123/intent-dashboard?");
    expect(url).toContain("var-intent_id=I04fb0697e3a243e7a292c6cb57e9f797");
    expect(url).toContain("var-condition_metrics=metric_COabc");
    expect(url).toContain("from=now-3h");
    expect(url).toContain("to=now");
  });

  it("passes each condition metric as a separate grafana variable", () => {
    const url = buildIntentGrafanaUrl({
      intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
      conditionMetrics: ["metric_COabc", "metric_COdef"],
      bounds: null,
      env: {
        baseUrl: "http://grafana.example:3001",
        dashboardUid: "abc123",
        dashboardSlug: "intent-dashboard",
      },
    });

    expect(url).toContain("var-condition_metrics=metric_COabc");
    expect(url).toContain("var-condition_metrics=metric_COdef");
    expect(url).not.toContain("metric_COabc,metric_COdef");
  });

  it("includes kg target params when repository and graph are provided", () => {
    const url = buildIntentGrafanaUrl({
      intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
      conditionMetrics: [],
      bounds: null,
      repositoryId: "telenor-5g4data-kg-my-experiment",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-my-experiment",
      env: {
        baseUrl: "http://grafana.example:3001",
        dashboardUid: "abc123",
        dashboardSlug: "intent-dashboard",
      },
    });

    expect(url).toContain("var-repository_id=telenor-5g4data-kg-my-experiment");
    expect(url).toContain(
      "var-graph_iri=urn%3Aintend%3Akg%3Atelenor-5g4data%3Akg-my-experiment",
    );
  });

  it("omits kg target params when repository and graph are absent", () => {
    const url = buildIntentGrafanaUrl({
      intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
      conditionMetrics: [],
      bounds: null,
      repositoryId: null,
      graphIri: null,
      env: {
        baseUrl: "http://grafana.example:3001",
        dashboardUid: "abc123",
        dashboardSlug: "intent-dashboard",
      },
    });

    expect(url).not.toContain("var-repository_id=");
    expect(url).not.toContain("var-graph_iri=");
  });

  it("builds historic grafana url with epoch bounds", () => {
    const nowMs = Date.now();
    const bounds = {
      minMs: nowMs - 7 * 24 * 60 * 60 * 1000,
      maxMs: nowMs - 24 * 60 * 60 * 1000,
    };
    const time = buildGrafanaTimeParams(bounds);
    expect(isStreamingBounds(bounds, nowMs)).toBe(false);
    expect(time.from).not.toBe("now-3h");
    expect(Number(time.from)).toBeLessThan(bounds.minMs);
    expect(Number(time.to)).toBeGreaterThan(bounds.maxMs);
  });

  it("returns null when grafana base url is unset", () => {
    expect(
      buildIntentGrafanaUrl({
        intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
        conditionMetrics: [],
        bounds: null,
        env: {
          baseUrl: null,
          dashboardUid: "abc123",
          dashboardSlug: "intent-dashboard",
        },
      }),
    ).toBeNull();
  });
});

describe("clear-intent-observations-query", () => {
  it("deletes observations and metadata for compound metrics", () => {
    const query = buildClearIntentObservationsUpdate("http://example/graph", [
      "metric_COabc123",
    ]);

    expect(query).toContain("GRAPH <http://example/graph>");
    expect(query).toContain("GRAPH <http://intent-reports-metadata>");
    expect(query).toContain("<http://5g4data.eu/5g4data#metric_COabc123>");
    expect(query).toContain("met:Observation");
  });
});

describe("observation-time-bounds helpers", () => {
  it("adds padding around historic windows", () => {
    const nowMs = 1_700_020_000_000;
    const window = historicGrafanaWindow(
      {
        minMs: 1_700_000_000_000,
        maxMs: 1_700_010_000_000,
      },
      nowMs,
    );

    expect(window.fromMs).toBeLessThan(1_700_000_000_000);
    expect(window.toMs).toBeGreaterThan(1_700_010_000_000);
  });
});
