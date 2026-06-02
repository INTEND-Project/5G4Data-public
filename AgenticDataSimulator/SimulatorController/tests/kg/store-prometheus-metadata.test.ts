import { describe, expect, it } from "vitest";

import {
  buildDeletePrometheusMetadataUpdate,
} from "../../src/lib/kg/store-prometheus-metadata";
import { resolvePrometheusExecutorBaseUrl } from "../../src/lib/prometheus/resolve-executor-base-url";

describe("store-prometheus-metadata", () => {
  it("buildDeletePrometheusMetadataUpdate removes hasQuery triples for one metric", () => {
    const update = buildDeletePrometheusMetadataUpdate("p99-token-target_COabc");
    expect(update).toContain("DELETE");
    expect(update).toContain("WHERE");
    expect(update).toContain("p99-token-target_COabc");
    expect(update).toContain("data5g:hasQuery");
    expect(update).toContain("intent-reports-metadata");
  });

  it("resolvePrometheusExecutorBaseUrl defaults to local Caddy path", () => {
    const previous = process.env.PROMETHEUS_EXECUTOR_URL;
    delete process.env.PROMETHEUS_EXECUTOR_URL;
    expect(resolvePrometheusExecutorBaseUrl()).toBe("http://127.0.0.1:9090/prometheus/");
    if (previous !== undefined) {
      process.env.PROMETHEUS_EXECUTOR_URL = previous;
    }
  });
});
