import { describe, expect, it } from "vitest";

import { buildObservationReportSeed } from "../../src/lib/dsl/observation-report-seed";
import { resolveIntentIdForObservation } from "../../src/lib/intent/resolve-intent-ref";

describe("resolveIntentIdForObservation", () => {
  it("returns canonical id when for clause uses I… directly", () => {
    const canonical = "I9fde73e5715a43beb4dcd6053c7b8b82";
    expect(resolveIntentIdForObservation(canonical, new Map())).toBe(canonical);
  });

  it("returns stored id when for clause uses create-intent alias", () => {
    const aliases = new Map([["llmIntent", "I9fde73e5715a43beb4dcd6053c7b8b82"]]);
    expect(resolveIntentIdForObservation("llmIntent", aliases)).toBe(
      "I9fde73e5715a43beb4dcd6053c7b8b82",
    );
  });

  it("returns null for unknown alias", () => {
    expect(resolveIntentIdForObservation("llmIntent", new Map())).toBeNull();
  });

  it("supports canonical ids for extract-metric-catalog and observation-report for clauses", () => {
    const canonical = "I9fde73e5715a43beb4dcd6053c7b8b82";
    expect(resolveIntentIdForObservation(canonical, new Map())).toBe(canonical);
  });
});

describe("observation-report seed with create-intent alias", () => {
  it("injects resolved canonical id when for llmIntent", () => {
    const aliases = new Map([["llmIntent", "I9fde73e5715a43beb4dcd6053c7b8b82"]]);
    const canonicalId = resolveIntentIdForObservation("llmIntent", aliases);
    expect(canonicalId).toBe("I9fde73e5715a43beb4dcd6053c7b8b82");

    const instructions =
      "`mode=historic`, `start=17.05.2026 05:00:00`, `stop=18.05.2026 05:00:00`, `frequency=60s`. " +
      "For `metric=p99-token-target`, between 06:00 and 18:00 keep values in the 500-2000 range with daily variation and low noise. " +
      "During 08:00-09:00 and 16:00-17:00 allow short dips down to between 200-300";
    const seed = buildObservationReportSeed(canonicalId!, instructions);

    expect(seed).toContain(
      "`intent_id=I9fde73e5715a43beb4dcd6053c7b8b82`, `mode=historic`, `start=17.05.2026 05:00:00`",
    );
    expect(seed).toContain("`metric=p99-token-target`");
    expect(seed).not.toContain("Generate observation reports for");
    expect(seed).not.toContain("Instructions:");
  });
});
