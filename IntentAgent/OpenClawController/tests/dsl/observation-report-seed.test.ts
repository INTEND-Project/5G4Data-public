import { describe, expect, it } from "vitest";

import {
  buildObservationReportSeed,
  instructionsAlreadyDeclareIntentId,
} from "../../src/lib/dsl/observation-report-seed";

describe("observation-report seed", () => {
  it("detects intent_id= at line start", () => {
    expect(instructionsAlreadyDeclareIntentId("intent_id=Iabc")).toBe(true);
    expect(instructionsAlreadyDeclareIntentId("  intent_id=Iabc")).toBe(true);
  });

  it("detects intent_id= inside backticks", () => {
    const body =
      "`intent_id=I6be57670fcad46fba1f648ad28b9cdb5`, `mode=historic`, `frequency=60s`.";
    expect(instructionsAlreadyDeclareIntentId(body)).toBe(true);
  });

  it("does not treat unrelated backticks as intent_id", () => {
    expect(instructionsAlreadyDeclareIntentId("`mode=historic`, `frequency=60s`.")).toBe(false);
  });

  it("omits prelude when intent_id is already in backtick instructions", () => {
    const instructions =
      "`intent_id=I6be57670fcad46fba1f648ad28b9cdb5`, `mode=historic`. For metric=foo.";
    const seed = buildObservationReportSeed(
      "I6be57670fcad46fba1f648ad28b9cdb5",
      "I6be57670fcad46fba1f648ad28b9cdb5",
      instructions,
    );
    expect(seed.startsWith("intent_id=")).toBe(false);
    expect(seed).toContain("Generate observation reports");
    expect(seed).toContain(instructions);
  });

  it("prepends intent_id= when not declared in instructions", () => {
    const seed = buildObservationReportSeed("avalancheIntent", "Iabc", "For metric bandwidth.");
    expect(seed.startsWith("intent_id=avalancheIntent\n\n")).toBe(true);
  });
});
