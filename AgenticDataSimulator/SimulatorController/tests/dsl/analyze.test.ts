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

  it("accepts observation-report for canonical intent id without create-intent alias", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const validatorModule = await import("../../src/lib/dsl/validator/validate-script");

    const script = `discover observation-agent by domain 5g4data as observationControl
request observation-report using observationControl for I6be57670fcad46fba1f648ad28b9cdb5 instructions "For metric bandwidth keep values in range." as observationSession`;

    const parsed = parserModule.parseScript(script);
    const diagnostics = validatorModule.validateScript(parsed.statements);

    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "discover",
      "request-observation-report",
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("parses create intent with storage graphdb and request observation-report with storage override", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const validatorModule = await import("../../src/lib/dsl/validator/validate-script");

    const script = `discover intent-agent by domain 5g4data as intentGen
create intent using intentGen storage graphdb prompt "Deploy LLM" as llmIntent
discover observation-agent by domain 5g4data as observationControl
request observation-report using observationControl for llmIntent storage prometheus instructions "For metric foo." as obsSession`;

    const parsed = parserModule.parseScript(script);
    const diagnostics = validatorModule.validateScript(parsed.statements);

    expect(diagnostics).toEqual([]);
    const createStmt = parsed.statements.find((s) => s.kind === "create-intent");
    const obsStmt = parsed.statements.find((s) => s.kind === "request-observation-report");
    expect(createStmt && createStmt.kind === "create-intent" && createStmt.storage).toBe("graphdb");
    expect(
      obsStmt &&
        obsStmt.kind === "request-observation-report" &&
        obsStmt.storage === "prometheus",
    ).toBe(true);
  });

  it("defaults create intent storage to graphdb when omitted", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const parsed = parserModule.parseScript(
      'create intent using intentGen prompt "Deploy" as x',
    );
    const stmt = parsed.statements[0];
    expect(stmt?.kind).toBe("create-intent");
    if (stmt?.kind === "create-intent") {
      expect(stmt.storage).toBe("graphdb");
    }
  });

  it("accepts structured observation-report for create-intent alias without intent_id in instructions", async () => {
    const parserModule = await import("../../src/lib/dsl/parser/parse-script");
    const validatorModule = await import("../../src/lib/dsl/validator/validate-script");

    const script = `discover intent-agent by domain 5g4data as intentGen
create intent using intentGen prompt "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner" as llmIntent
discover observation-agent by domain 5g4data as observationControl
request observation-report using observationControl for llmIntent instructions "\`mode=historic\`, \`start=17.05.2026 05:00:00\`, \`stop=18.05.2026 05:00:00\`, \`frequency=60s\`. For \`metric=p99-token-target\`, between 06:00 and 18:00 keep values in the 500-2000 range with daily variation and low noise. During 08:00-09:00 and 16:00-17:00 allow short dips down to between 200-300" as llmObservationSession`;

    const parsed = parserModule.parseScript(script);
    const diagnostics = validatorModule.validateScript(parsed.statements);

    expect(parsed.statements.map((statement) => statement.kind)).toEqual([
      "discover",
      "create-intent",
      "discover",
      "request-observation-report",
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

  it("reports INVALID_SYNTAX for unrecognized DSL lines", async () => {
    const analyzeModule = await import("../../src/lib/dsl/analysis/analyze-script");

    const { statements, diagnostics } = analyzeModule.analyzeScript(
      "this is not valid dsl syntax",
    );

    expect(statements).toEqual([]);
    expect(diagnostics).toEqual([
      {
        line: 1,
        severity: "error",
        code: "INVALID_SYNTAX",
        message:
          "Unrecognized DSL statement. Expected discover, create intent, extract metric-catalog, request status-report, or request observation-report.",
      },
    ]);
  });
});
