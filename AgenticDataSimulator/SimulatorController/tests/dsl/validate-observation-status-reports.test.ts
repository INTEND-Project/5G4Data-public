import { describe, expect, it } from "vitest";
import { parseScript } from "@/lib/dsl/parser/parse-script";
import { validateScript } from "@/lib/dsl/validator/validate-script";
import {
  parseObservationStatusReportsFlag,
  validateObservationStatusReportSingleStatement,
} from "@/lib/dsl/validator/validate-observation-status-reports";

describe("validateObservationStatusReportSingleStatement", () => {
  it("parses status_reports globals", () => {
    expect(parseObservationStatusReportsFlag("`status_reports=on`")).toBe(true);
    expect(parseObservationStatusReportsFlag("`status_reports=off`")).toBe(false);
    expect(parseObservationStatusReportsFlag("`mode=historic`")).toBeNull();
  });

  it("allows multiple observation-report lines when status is off or omitted", () => {
    const script = `discover observation-agent by domain 5g4data as obs
create intent using intentGen prompt "x" as myIntent
request observation-report using obs for myIntent instructions "\`mode=historic\`, \`frequency=60s\`, \`metric=a\` ok." as s1
request observation-report using obs for myIntent instructions "\`mode=historic\`, \`frequency=60s\`, \`metric=b\` ok." as s2`;
    // create-intent needs discover - simplify via statements only
    const parsed = parseScript(`discover observation-agent by domain 5g4data as obs
request observation-report using obs for Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa instructions "\`mode=historic\`, \`frequency=60s\`. For \`metric=a\`, ok." as s1
request observation-report using obs for Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa instructions "\`mode=historic\`, \`frequency=60s\`. For \`metric=b\`, ok." as s2`);
    const statusDiags = validateObservationStatusReportSingleStatement(parsed.statements);
    expect(statusDiags).toEqual([]);
  });

  it("rejects multiple observation-report lines when status_reports=on", () => {
    const parsed = parseScript(`discover observation-agent by domain 5g4data as obs
request observation-report using obs for Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa instructions "\`mode=historic\`, \`frequency=60s\`, \`status_reports=on\`. For \`metric=a\`, ok." as s1
request observation-report using obs for Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa instructions "\`mode=historic\`, \`frequency=60s\`, \`status_reports=on\`. For \`metric=b\`, ok." as s2`);
    const diagnostics = validateScript(parsed.statements);
    expect(diagnostics.some((d) => d.code === "STATUS_REPORTS_MULTI_STATEMENT")).toBe(true);
  });

  it("allows a single multi-metric statement with status_reports=on", () => {
    const parsed = parseScript(`discover observation-agent by domain 5g4data as obs
request observation-report using obs for Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa instructions "\`mode=historic\`, \`frequency=60s\`, \`status_reports=on\`. For \`metric=a\`, ok. For \`metric=b\`, ok." as s1`);
    const diagnostics = validateScript(parsed.statements);
    expect(diagnostics.filter((d) => d.code === "STATUS_REPORTS_MULTI_STATEMENT")).toEqual([]);
  });
});
