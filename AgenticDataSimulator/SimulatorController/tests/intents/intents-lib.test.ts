import { describe, expect, it } from "vitest";

import {
  buildGrafanaTimeParams,
  buildIntentGrafanaUrl,
} from "../../src/lib/grafana/intent-dashboard-url";
import { parseStorageFromIntentTurtle, resolveIntentStorage } from "../../src/lib/intents/resolve-intent-storage";
import {
  historicGrafanaWindow,
  isStreamingBounds,
} from "../../src/lib/intents/observation-time-bounds";
import { buildClearIntentObservationsUpdate } from "../../src/lib/intents/clear-intent-observations-query";

describe("resolve-intent-storage", () => {
  it("prefers prometheus when reportDestinations includes prometheus", () => {
    const turtle = `
@prefix icm: <http://example/icm/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

_:x icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
`.trim();

    expect(parseStorageFromIntentTurtle(turtle)).toBe("prometheus");
    expect(resolveIntentStorage({ intentTurtle: turtle, inPrometheus: false })).toBe("prometheus");
  });

  it("falls back to prometheus when only present in Prometheus", () => {
    expect(resolveIntentStorage({ intentTurtle: null, inPrometheus: true })).toBe("prometheus");
  });

  it("defaults to graphdb when turtle and prometheus are absent", () => {
    expect(resolveIntentStorage({ intentTurtle: null, inPrometheus: false })).toBe("graphdb");
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

  it("builds historic grafana url with epoch bounds", () => {
    const bounds = { minMs: 1_700_000_000_000, maxMs: 1_700_010_000_000 };
    const time = buildGrafanaTimeParams(bounds);
    expect(isStreamingBounds(bounds, 1_700_020_000_000)).toBe(false);
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
    const window = historicGrafanaWindow({
      minMs: 1_000_000,
      maxMs: 1_100_000,
    });

    expect(window.fromMs).toBeLessThan(1_000_000);
    expect(window.toMs).toBeGreaterThan(1_100_000);
  });
});
