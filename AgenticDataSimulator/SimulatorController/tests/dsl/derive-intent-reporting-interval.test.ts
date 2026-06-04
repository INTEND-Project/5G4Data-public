import { describe, expect, it } from "vitest";

import { deriveIntentReportingIntervalFromScript } from "@/lib/dsl/analysis/derive-intent-reporting-interval";
import { parseScript } from "@/lib/dsl/parser/parse-script";

describe("deriveIntentReportingIntervalFromScript", () => {
  it("maps fastest frequency in seconds without rounding to minutes", () => {
    const script = `discover intent-agent by domain telenor.5g4data as intentGen
create intent using intentGen storage prometheus prompt "LLM" as llmIntent
discover observation-agent by domain telenor.5g4data as observationControl
request observation-report using observationControl for llmIntent storage prometheus instructions "\`mode=historic\`, \`frequency=60s\`. For \`metric=a\`." as obs1
request observation-report using observationControl for llmIntent storage prometheus instructions "\`mode=historic\`, \`frequency=360s\`. For \`metric=b\`." as obs2`;

    const { statements } = parseScript(script);
    const { byIntentAlias, diagnostics } = deriveIntentReportingIntervalFromScript(statements);

    expect(byIntentAlias.get("llmIntent")).toBe(60);
    expect(diagnostics.some((d) => d.code === "REPORTING_INTERVAL_FREQUENCY_CONFLICT")).toBe(true);
  });

  it("keeps 300 seconds for frequency=300s", () => {
    const script = `discover observation-agent by domain d as observationControl
request observation-report using observationControl for llmIntent instructions "\`mode=streaming\`, \`frequency=300s\`. For \`metric=x\`." as obs`;

    const { statements } = parseScript(script);
    const { byIntentAlias } = deriveIntentReportingIntervalFromScript(statements);
    expect(byIntentAlias.get("llmIntent")).toBe(300);
  });

  it("returns empty map when no frequency in observation lines", () => {
    const script = `request observation-report using observationControl for llmIntent instructions "For metric bandwidth keep range." as obs`;
    const { statements } = parseScript(script);
    const { byIntentAlias } = deriveIntentReportingIntervalFromScript(statements);
    expect(byIntentAlias.size).toBe(0);
  });
});
