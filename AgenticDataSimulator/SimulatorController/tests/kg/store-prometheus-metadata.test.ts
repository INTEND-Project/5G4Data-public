import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDeletePrometheusMetadataUpdate,
} from "../../src/lib/kg/store-prometheus-metadata";
import { resolvePrometheusExecutorBaseUrl } from "../../src/lib/prometheus/resolve-executor-base-url";

const originalEnv = { ...process.env };

describe("store-prometheus-metadata", () => {
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
    process.env = originalEnv;
  });
  it("buildDeletePrometheusMetadataUpdate removes hasQuery triples for one metric", () => {
    const update = buildDeletePrometheusMetadataUpdate("p99-token-target_COabc");
    expect(update).toContain("DELETE");
    expect(update).toContain("WHERE");
    expect(update).toContain("p99-token-target_COabc");
    expect(update).toContain("data5g:hasQuery");
    expect(update).toContain("intent-reports-metadata");
  });

  it("resolvePrometheusExecutorBaseUrl uses workspace override when provided", () => {
    expect(resolvePrometheusExecutorBaseUrl("https://partner.example/prometheus")).toBe(
      "https://partner.example/prometheus/",
    );
  });

  it("resolvePrometheusExecutorBaseUrl falls back to executor env", () => {
    process.env.PROMETHEUS_EXECUTOR_URL = "http://127.0.0.1:9090";
    expect(resolvePrometheusExecutorBaseUrl()).toBe("http://127.0.0.1:9090/");
  });
});
