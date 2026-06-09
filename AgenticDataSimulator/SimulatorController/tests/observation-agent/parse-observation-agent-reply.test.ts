import { describe, expect, it } from "vitest";

import { parseObservationAgentFailure } from "../../src/lib/observation-agent/parse-observation-agent-reply";

describe("parseObservationAgentFailure", () => {
  const intentId = "Iabc1234567890123456789012345678";

  it("parses repl hook failures", () => {
    const entry = parseObservationAgentFailure(
      "Observation hook failed: Cannot find module '/5g4data-intent-generation/tools/prettyPrintIntentTurtle.js'",
      intentId,
    );
    expect(entry?.kind).toBe("repl_hook_failed");
    expect(entry?.message).toContain("Cannot find module");
    expect(entry?.intentId).toBe(intentId);
  });

  it("parses GraphDB resolution failures", () => {
    const entry = parseObservationAgentFailure(
      `Intent ${intentId} could not be resolved from GraphDB. Synthetic run aborted.`,
      intentId,
    );
    expect(entry?.kind).toBe("synthetic_setup_failed");
    expect(entry?.message).toContain("could not be resolved");
  });

  it("ignores successful agent replies", () => {
    expect(
      parseObservationAgentFailure(
        "Started synthetic observation workers for 3 metrics.",
        intentId,
      ),
    ).toBeNull();
  });
});
