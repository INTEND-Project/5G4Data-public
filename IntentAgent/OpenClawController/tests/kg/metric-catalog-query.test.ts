import { describe, expect, it } from "vitest";

import {
  buildMetricCatalogQuery,
  escapeSparqlStringLiteral,
  parseIntentLocalIdForMetricCatalog,
} from "../../src/lib/kg/metric-catalog-query";

describe("metric-catalog-query", () => {
  it("escapes SparQL string literals", () => {
    expect(escapeSparqlStringLiteral('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("normalizes bare uuid to canonical intent id", () => {
    expect(parseIntentLocalIdForMetricCatalog("ebf6b23563a14494a136188776cb5f54")).toBe(
      "Iebf6b23563a14494a136188776cb5f54",
    );
    expect(parseIntentLocalIdForMetricCatalog("bogus")).toBeNull();
  });

  it("buildMetricCatalogQuery embeds GRAPH, intent literal, and TM Forum prefixes", () => {
    const graph = "urn:intend:kg:demo:test";
    const intent = "I04fb0697e3a243e7a292c6cb57e9f797";
    const q = buildMetricCatalogQuery(graph, intent);

    expect(q).toContain(`GRAPH <${graph}> {`);
    expect(q).toContain('VALUES ?intentId { "I04fb0697e3a243e7a292c6cb57e9f797" }');
    expect(q).toContain("PREFIX log:");
    expect(q).toContain("PREFIX icm:");
    expect(q).toContain("PREFIX set:");
    expect(q).toContain("?metricNode icm:valuesOfTargetProperty ?metric");
    expect(q).toContain("ORDER BY ?metric_name");
  });

  it("rejects unsafe graph iris for angle-bracket embedding", () => {
    expect(() => buildMetricCatalogQuery("bad iri\n", "I04fb0697e3a243e7a292c6cb57e9f797")).toThrow();
    expect(() => buildMetricCatalogQuery("", "I04fb0697e3a243e7a292c6cb57e9f797")).toThrow();
  });
});
