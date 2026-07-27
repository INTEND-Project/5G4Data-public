import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const analyzeScriptMock = vi.fn();
const dbMock = {
  scriptRun: {
    create: vi.fn(),
  },
  script: {
    findFirst: vi.fn(),
  },
  knowledgeGraphTarget: {
    findFirst: vi.fn(),
  },
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/auth/guards", () => guardMock);
vi.mock("../../src/lib/db", () => ({
  db: dbMock,
}));
vi.mock("../../src/lib/dsl/analysis/analyze-script", () => ({
  analyzeScript: analyzeScriptMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("run pipeline routes", () => {
  it("dry-runs a script and returns diagnostics without persisting a run", async () => {
    analyzeScriptMock.mockReturnValue({
      statements: [{ kind: "discover" }],
      diagnostics: [],
    });

    const routeModule = await import("../../src/app/api/runs/dry-run/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/runs/dry-run", {
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
      mode: "dry-run",
      statements: [{ kind: "discover" }],
      diagnostics: [],
    });
    expect(dbMock.scriptRun.create).not.toHaveBeenCalled();
  });

  it("executes a persisted script against a selected KG target and stores the run", async () => {
    analyzeScriptMock.mockReturnValue({
      statements: [
        { kind: "discover" },
        { kind: "create-intent" },
        { kind: "extract-metric-catalog" },
        { kind: "request-observation-report" },
      ],
      diagnostics: [],
    });
    dbMock.script.findFirst.mockResolvedValue({
      id: "script-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      name: "avalanche-search.control.dsl",
      content:
        'discover intent-agent by domain 5g4data as intentGen\ncreate intent using intentGen prompt "Deploy avalanche object detection" as avalancheIntent',
    });
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    });
    dbMock.scriptRun.create.mockResolvedValue({
      id: "run-1",
      scriptId: "script-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      mode: "execute",
      status: "completed",
      graphTargetId: "kg-target-1",
    });

    const routeModule = await import("../../src/app/api/runs/execute/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/runs/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scriptId: "script-1",
          graphTargetId: "kg-target-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      run: {
        id: "run-1",
        scriptId: "script-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        mode: "execute",
        status: "completed",
        graphTargetId: "kg-target-1",
      },
      orchestration: {
        executedStatements: 4,
        selectedGraphTargetId: "kg-target-1",
      },
      diagnostics: [],
    });
  });
});
