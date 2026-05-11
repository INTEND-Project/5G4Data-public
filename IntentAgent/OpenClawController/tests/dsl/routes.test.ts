import { beforeEach, describe, expect, it, vi } from "vitest";

const analyzeScriptMock = vi.fn();
const buildCompletionContextMock = vi.fn();

vi.mock("../../src/lib/dsl/analysis/analyze-script", () => ({
  analyzeScript: analyzeScriptMock,
}));

vi.mock("../../src/lib/dsl/analysis/build-completion-context", () => ({
  buildCompletionContext: buildCompletionContextMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("dsl routes", () => {
  it("returns parsed statements and diagnostics from the analyze route", async () => {
    analyzeScriptMock.mockReturnValue({
      statements: [{ kind: "discover" }],
      diagnostics: [],
    });

    const routeModule = await import("../../src/app/api/dsl/analyze/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/dsl/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          script: "discover intent-agent by domain 5g4data as intentGen",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      statements: [{ kind: "discover" }],
      diagnostics: [],
    });
  });

  it("returns metric-name suggestions from the completions route", async () => {
    buildCompletionContextMock.mockReturnValue({
      stage: "reporting",
      metricNames: ["bandwidth", "detection-latency"],
    });

    const routeModule = await import("../../src/app/api/dsl/completions/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/dsl/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          script: 'request observation-report using observationControl for avalancheIntent instructions "For metric " as observationSession',
          extractedMetricCatalogs: {
            avalancheMetrics: ["bandwidth", "detection-latency"],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      stage: "reporting",
      metricNames: ["bandwidth", "detection-latency"],
    });
  });
});
