import { describe, expect, it } from "vitest";

import {
  buildStemToCompoundMap,
  extractCompoundMetricsFromObservationInstructions,
  resolveMetricStemsInObservationInstructions,
} from "../../src/lib/dsl/analysis/extract-metric-catalog";
import { buildObservationReportSeed } from "../../src/lib/dsl/observation-report-seed";

const catalog = [
  "p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4",
  "bandwidth_CO87a0d8360e3f46519672120b93aac41e",
  "bandwidth_CO11111111111111111111111111111111",
  "detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
  "plainMetric",
];

describe("buildStemToCompoundMap", () => {
  it("maps unique stems to full compound names and preserves identity", () => {
    const map = buildStemToCompoundMap(catalog);
    expect(map.get("p99-token-target")).toBe(
      "p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4",
    );
    expect(map.get("detection-latency")).toBe(
      "detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
    );
    expect(map.get("p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4")).toBe(
      "p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4",
    );
    expect(map.has("bandwidth")).toBe(false);
    expect(map.get("plainMetric")).toBe("plainMetric");
  });
});

describe("resolveMetricStemsInObservationInstructions", () => {
  it("resolves metric=stem without backticks before punctuation", () => {
    const instructions =
      "`mode=historic`, `frequency=60s`. For metric=detection-latency, between 06:00 and 18:00.";
    const result = resolveMetricStemsInObservationInstructions(instructions, catalog);

    expect(result.instructions).toContain(
      "metric=detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
    );
    expect(result.instructions).not.toContain("metric=detection-latency,");
    expect(result.resolved).toEqual([
      {
        stem: "detection-latency",
        compound: "detection-latency_CO276f7a8c089b4962a3236fe58f21953a",
      },
    ]);
  });

  it("resolves a unique stem inside backticks", () => {
    const instructions =
      "`mode=historic`, `frequency=60s`. For `metric=p99-token-target`, between 06:00 and 18:00.";
    const result = resolveMetricStemsInObservationInstructions(instructions, catalog);

    expect(result.instructions).toContain(
      "`metric=p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4`",
    );
    expect(result.instructions).not.toContain("`metric=p99-token-target`,");
    expect(result.resolved).toEqual([
      {
        stem: "p99-token-target",
        compound: "p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4",
      },
    ]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it("leaves already-full compound names unchanged", () => {
    const full = "p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4";
    const instructions = `For \`metric=${full}\`, keep values steady.`;
    const result = resolveMetricStemsInObservationInstructions(instructions, catalog);

    expect(result.instructions).toBe(instructions);
    expect(result.resolved).toEqual([]);
  });

  it("resolves multiple metric= clauses in one instruction string", () => {
    const instructions =
      "`metric=p99-token-target` baseline. `metric=detection-latency` latency 15-40ms.";
    const result = resolveMetricStemsInObservationInstructions(instructions, catalog);

    expect(result.instructions).toContain(
      "`metric=p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4`",
    );
    expect(result.instructions).toContain(
      "`metric=detection-latency_CO276f7a8c089b4962a3236fe58f21953a`",
    );
    expect(result.resolved).toHaveLength(2);
  });

  it("leaves ambiguous stems unchanged when multiple compounds share a stem", () => {
    const instructions = "For `metric=bandwidth`, keep values in the 55-90 range.";
    const result = resolveMetricStemsInObservationInstructions(instructions, catalog);

    expect(result.instructions).toBe(instructions);
    expect(result.resolved).toEqual([]);
    expect(result.ambiguous).toEqual(["bandwidth"]);
  });

  it("leaves unknown stems unchanged", () => {
    const instructions = "For `metric=unknown-metric`, keep values steady.";
    const result = resolveMetricStemsInObservationInstructions(instructions, catalog);

    expect(result.instructions).toBe(instructions);
    expect(result.resolved).toEqual([]);
    expect(result.unmatched).toEqual(["unknown-metric"]);
  });

  it("does not rewrite non-metric key/value tokens", () => {
    const instructions =
      "`intent_id=Iabc`, `mode=historic`, `frequency=60s`. For `metric=p99-token-target`, values.";
    const result = resolveMetricStemsInObservationInstructions(instructions, catalog);

    expect(result.instructions).toContain("`intent_id=Iabc`");
    expect(result.instructions).toContain("`mode=historic`");
    expect(result.instructions).toContain("`frequency=60s`");
  });

  it("returns instructions unchanged when catalog is empty", () => {
    const instructions = "For `metric=p99-token-target`, values.";
    const result = resolveMetricStemsInObservationInstructions(instructions, []);

    expect(result.instructions).toBe(instructions);
    expect(result.resolved).toEqual([]);
  });

  it("extracts every compound metric from structured instructions", () => {
    const instructions =
      "`metric=metricA_COabc1234567890123456789012345678`, notes. `metric=metricB_COabc1234567890123456789012345678`, more.";
    expect(extractCompoundMetricsFromObservationInstructions(instructions)).toEqual([
      "metricA_COabc1234567890123456789012345678",
      "metricB_COabc1234567890123456789012345678",
    ]);
  });

  it("resolved instructions appear in the observation seed body", () => {
    const canonicalId = "I9fde73e5715a43beb4dcd6053c7b8b82";
    const instructions =
      "`mode=historic`, `frequency=60s`. For `metric=p99-token-target`, between 06:00 and 18:00.";
    const { instructions: resolved } = resolveMetricStemsInObservationInstructions(
      instructions,
      catalog,
    );
    const seed = buildObservationReportSeed(canonicalId, resolved);

    expect(seed).toContain(
      "`metric=p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4`",
    );
    expect(seed).not.toContain("`metric=p99-token-target`,");
  });
});
