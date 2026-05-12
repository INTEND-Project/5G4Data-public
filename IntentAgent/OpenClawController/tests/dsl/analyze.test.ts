import { describe, expect, it } from "vitest";

const validScript = `# Stage 1
discover intent-agent by domain 5g4data as intentGen
create intent using intentGen prompt "Deploy avalanche object detection" as avalancheIntent
extract metric-catalog for avalancheIntent as avalancheMetrics
discover observation-agent by domain 5g4data as observationControl

# Stage 2
request observation-report using observationControl for avalancheIntent instructions "For metric bandwidth keep values in the 55-90 mbit/s range with daily variation." as observationSession`;

describe("DSL foundation", () => {
  it("parses and validates the two-stage controller flow", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const validatorModule = await import("../../src/lib/dsl/validator/validate-script");

    const parsed = parserModule.parseScript(validScript);
    const diagnostics = validatorModule.validateScript(parsed.statements);

    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "discover",
      "create-intent",
      "extract-metric-catalog",
      "discover",
      "request-observation-report",
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("reports unknown aliases as typed diagnostics", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const validatorModule = await import("../../src/lib/dsl/validator/validate-script");

    const parsed = parserModule.parseScript(
      'request status-report using statusControl for missingIntent instructions "Every 5 minutes" as statusSession',
    );
    const diagnostics = validatorModule.validateScript(parsed.statements);

    expect(diagnostics).toEqual([
      {
        line: 1,
        severity: "error",
        code: "UNKNOWN_AGENT_ALIAS",
        message: 'Unknown agent alias "statusControl".',
      },
      {
        line: 1,
        severity: "error",
        code: "UNKNOWN_INTENT_ALIAS",
        message: 'Unknown intent alias "missingIntent".',
      },
    ]);
  });

  it("parses workspace domain discovery paired with implicit intentGen", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const validatorModule = await import("../../src/lib/dsl/validator/validate-script");

    const script = `discover intent-agent for domain as agentCardBinding
create intent using intentGen prompt "Deploy avalanche object detection in Tromsø" as avalancheIntentAlias`;

    const parsed = parserModule.parseScript(script);
    const diagnostics = validatorModule.validateScript(parsed.statements);

    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "discover-intent-workspace-domain",
      "create-intent",
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("reports intentGen misuse when no qualifying discovery preceded it", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const validatorModule = await import("../../src/lib/dsl/validator/validate-script");

    const parsed = parserModule.parseScript(
      'create intent using intentGen prompt "Need help" as demoIntentAlias',
    );
    const diagnostics = validatorModule.validateScript(parsed.statements);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toEqual("UNKNOWN_AGENT_ALIAS");
  });
});
