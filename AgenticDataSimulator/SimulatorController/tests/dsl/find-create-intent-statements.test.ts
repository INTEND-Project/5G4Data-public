import { describe, expect, it } from "vitest";

import { findCreateIntentStatements } from "../../src/lib/dsl/analysis/find-create-intent-statements";

describe("findCreateIntentStatements", () => {
  it("returns empty array when script has no create intent", () => {
    expect(findCreateIntentStatements('discover intent-agent by domain x as intentGen')).toEqual([]);
  });

  it("returns one candidate for a single create intent", () => {
    const script = `discover intent-agent by domain 5g4data as intentGen
create intent using intentGen prompt "Deploy LLM" as llmIntent`;
    const candidates = findCreateIntentStatements(script);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      line: 2,
      prompt: "Deploy LLM",
      intentAlias: "llmIntent",
      agentAlias: "intentGen",
    });
  });

  it("returns all create intent statements in script order", () => {
    const script = `create intent using intentGen prompt "First" as a
create intent using intentGen prompt "Second" as b`;
    const candidates = findCreateIntentStatements(script);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.prompt).toBe("First");
    expect(candidates[1]?.prompt).toBe("Second");
  });
});
