import { describe, expect, it } from "vitest";

import {
  buildObservationReportSeed,
  looksStructuredObservationInstructions,
  stripIntentIdFromInstructions,
} from "../../src/lib/dsl/observation-report-seed";

describe("observation-report seed", () => {
  it("strips intent_id= at line start", () => {
    expect(stripIntentIdFromInstructions("intent_id=Iabc")).toBe("");
    expect(stripIntentIdFromInstructions("  intent_id=Iabc")).toBe("");
  });

  it("strips intent_id= inside backticks", () => {
    const body =
      "`intent_id=I6be57670fcad46fba1f648ad28b9cdb5`, `mode=historic`, `frequency=60s`.";
    expect(stripIntentIdFromInstructions(body)).toBe("`mode=historic`, `frequency=60s`.");
  });

  it("does not strip unrelated backticks", () => {
    expect(stripIntentIdFromInstructions("`mode=historic`, `frequency=60s`.")).toBe(
      "`mode=historic`, `frequency=60s`.",
    );
  });

  it("detects structured observation instructions", () => {
    expect(looksStructuredObservationInstructions("`mode=historic`, `frequency=60s`.")).toBe(true);
    expect(looksStructuredObservationInstructions("For metric bandwidth.")).toBe(false);
  });

  it("injects intent_id into structured Instructions globals", () => {
    const instructions =
      "`intent_id=I6be57670fcad46fba1f648ad28b9cdb5`, `mode=historic`. For metric=foo.";
    const seed = buildObservationReportSeed("I6be57670fcad46fba1f648ad28b9cdb5", instructions);
    expect(seed).toContain(
      "Generate observation reports for `intent_id=I6be57670fcad46fba1f648ad28b9cdb5`.",
    );
    expect(seed).toContain(
      "Instructions:\n`intent_id=I6be57670fcad46fba1f648ad28b9cdb5`, `mode=historic`. For metric=foo.",
    );
  });

  it("does not duplicate intent_id in Instructions for natural-language prompts", () => {
    const seed = buildObservationReportSeed("Iabc", "For metric bandwidth.");
    expect(seed).toBe(
      "Generate observation reports for `intent_id=Iabc`.\n\nInstructions:\nFor metric bandwidth.",
    );
  });

  it("builds historic structured seed with injected intent_id", () => {
    const canonicalId = "I9fde73e5715a43beb4dcd6053c7b8b82";
    const instructions =
      "`mode=historic`, `start=17.05.2026 05:00:00`, `stop=18.05.2026 05:00:00`, `frequency=60s`. " +
      "For `metric=p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4`, between 06:00 and 18:00 keep values in the 500-2000 range.";
    const seed = buildObservationReportSeed(canonicalId, instructions);
    expect(seed).toContain(`Generate observation reports for \`intent_id=${canonicalId}\`.`);
    expect(seed).toContain(
      `Instructions:\n\`intent_id=${canonicalId}\`, \`mode=historic\`, \`start=17.05.2026 05:00:00\``,
    );
    expect(seed).toContain(
      "For `metric=p99-token-target_CO5e797700affd4ed880fe0ea6c2adf6b4`, between 06:00 and 18:00",
    );
  });
});
