import { describe, expect, it } from "vitest";

import {
  formatHistoricObservationRunHint,
  parseHistoricObservationWindow,
  readSynthObsHistoricMaxPoints,
  readSynthObsPromFlushChunk,
} from "../../src/lib/dsl/historic-observation-ticks";
import { validateHistoricObservationTickCap } from "../../src/lib/dsl/validator/validate-historic-observation-ticks";
import { validateScript } from "../../src/lib/dsl/validator/validate-script";
import { parseScript } from "../../src/lib/dsl/parser/parse-script";

describe("historic observation tick cap", () => {
  it("counts ticks for a one-year historic window at 60s", () => {
    const window = parseHistoricObservationWindow(
      "`mode=historic`, `start=21.05.2025 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target`, gauge values.",
    );

    expect(window).not.toBeNull();
    expect(window?.tickCount).toBe(527_041);
    expect(window?.frequencySeconds).toBe(60);
  });

  it("returns null for streaming or unstructured instructions", () => {
    expect(
      parseHistoricObservationWindow(
        "For metric bandwidth keep values in the 55-90 mbit/s range.",
      ),
    ).toBeNull();
    expect(
      parseHistoricObservationWindow(
        "`mode=streaming`, `frequency=60s`. For `metric=foo`, values in range.",
      ),
    ).toBeNull();
  });

  it("reports HISTORIC_TICK_CAP_EXCEEDED when ticks exceed the cap", () => {
    const diagnostic = validateHistoricObservationTickCap(
      14,
      "`mode=historic`, `start=21.05.2025 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target`, gauge.",
      250_000,
    );

    expect(diagnostic).toMatchObject({
      line: 14,
      severity: "error",
      code: "HISTORIC_TICK_CAP_EXCEEDED",
    });
    expect(diagnostic?.message).toContain("527,041 ticks");
    expect(diagnostic?.message).toContain("SYNTH_OBS_HISTORIC_MAX_POINTS (250,000)");
  });

  it("passes when tick count is within the cap", () => {
    const diagnostic = validateHistoricObservationTickCap(
      14,
      "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target`, gauge.",
      250_000,
    );

    expect(diagnostic).toBeNull();
  });

  it("validateScript surfaces tick cap errors for observation-report lines", () => {
    const script = `discover intent-agent by domain telenor.5g4data as intentGen
create intent using intentGen storage prometheus prompt "LLM near Tromsø" as llmIntent
discover observation-agent by domain telenor.5g4data as observationControl
request observation-report using observationControl for llmIntent storage prometheus instructions "\`mode=historic\`, \`start=21.05.2025 05:00:00\`, \`stop=22.05.2026 05:00:00\`, \`frequency=60s\`. For \`metric=p99-token-target\`, gauge range 700-1500." as llmObservationSession`;

    const parsed = parseScript(script);
    const diagnostics = validateScript(parsed.statements);

    expect(diagnostics.some((d) => d.code === "HISTORIC_TICK_CAP_EXCEEDED")).toBe(true);
  });

  it("readSynthObsHistoricMaxPoints falls back to default for invalid env", () => {
    expect(readSynthObsHistoricMaxPoints({})).toBe(250_000);
    expect(readSynthObsHistoricMaxPoints({ SYNTH_OBS_HISTORIC_MAX_POINTS: "500000" })).toBe(
      500_000,
    );
    expect(readSynthObsHistoricMaxPoints({ SYNTH_OBS_HISTORIC_MAX_POINTS: "nope" })).toBe(
      250_000,
    );
  });

  it("formatHistoricObservationRunHint mentions chunked remote write for prometheus", () => {
    const window = parseHistoricObservationWindow(
      "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`.",
    );
    expect(window).not.toBeNull();
    const hint = formatHistoricObservationRunHint(window!, "prometheus");
    expect(hint).toContain("remote-write");
    expect(hint).toContain(readSynthObsPromFlushChunk().toLocaleString("en-US"));
  });
});

describe("analyzeScript dry-run integration", () => {
  it("includes tick cap diagnostics in analyzeScript output", async () => {
    const analyzeModule = await import("../../src/lib/dsl/analysis/analyze-script");
    const script = `discover observation-agent by domain telenor.5g4data as observationControl
request observation-report using observationControl for I6be57670fcad46fba1f648ad28b9cdb5 instructions "\`mode=historic\`, \`start=21.05.2025 05:00:00\`, \`stop=22.05.2026 05:00:00\`, \`frequency=60s\`. For \`metric=energy-consumption\`, gauge." as obsSession`;

    const { diagnostics } = analyzeModule.analyzeScript(script);

    expect(diagnostics.some((d) => d.code === "HISTORIC_TICK_CAP_EXCEEDED")).toBe(true);
  });
});
