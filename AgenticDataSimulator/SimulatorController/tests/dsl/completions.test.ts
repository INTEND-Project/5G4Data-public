import { describe, expect, it } from "vitest";

const script = `discover intent-agent by domain 5g4data as intentGen
create intent using intentGen prompt "Deploy avalanche object detection" as avalancheIntent
extract metric-catalog for avalancheIntent as avalancheMetrics
discover observation-agent by domain 5g4data as observationControl
request observation-report using observationControl for avalancheIntent instructions "For metric " as observationSession`;

describe("DSL completion context", () => {
  it("returns empty metric names when no catalog has been extracted", async () => {
    const completionModule = await import(
      "../../src/lib/dsl/analysis/build-completion-context"
    );

    const context = completionModule.buildCompletionContext({
      script: "",
      extractedMetricCatalogs: {},
    });

    expect(context.metricNames).toEqual([]);
    expect(context.stage).toBe("discovery");
  });

  it("surfaces derived metric names for stage 2 completion suggestions", async () => {
    const completionModule = await import(
      "../../src/lib/dsl/analysis/build-completion-context"
    );

    const context = completionModule.buildCompletionContext({
      script,
      extractedMetricCatalogs: {
        avalancheMetrics: ["bandwidth", "detection-latency", "networklatency"],
      },
    });

    expect(context.metricNames).toEqual([
      "bandwidth",
      "detection-latency",
      "networklatency",
    ]);
    expect(context.stage).toBe("reporting");
  });
});
