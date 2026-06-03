import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const prepareIntentForToolMock = vi.fn();
const sendTmf921IntentMock = vi.fn();

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/tools/prepare-intent-for-tool", () => ({
  PrepareIntentError: class PrepareIntentError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  prepareIntentForTool: prepareIntentForToolMock,
}));

vi.mock("../../src/lib/tools/send-tmf921-intent", () => ({
  sendTmf921Intent: sendTmf921IntentMock,
}));

vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("POST /api/tools/send-intent", () => {
  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/tools/send-intent/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/tools/send-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "inCoord",
          tmfBaseUrl: "http://localhost:3021/tmf-api/intentManagement/v5",
          kgTargetId: "kg-1",
          intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    const routeModule = await import("../../src/app/api/tools/send-intent/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/tools/send-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId: "bad" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(prepareIntentForToolMock).not.toHaveBeenCalled();
  });

  it("prepares intent and posts to tool", async () => {
    prepareIntentForToolMock.mockResolvedValue({
      intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toolId: "inCoord",
      turtle: "@prefix imo: <> .",
      payload: {
        "@type": "Intent",
        name: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        description: "desc",
        expression: {
          "@type": "TurtleExpression",
          iri: "https://5g4data.eu/intent/Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          expressionValue: "@prefix imo: <> .",
        },
      },
    });
    sendTmf921IntentMock.mockResolvedValue({
      status: 201,
      body: { id: "tmf-1" },
      targetUrl: "http://localhost:3021/tmf-api/intentManagement/v5/intent",
    });

    const routeModule = await import("../../src/app/api/tools/send-intent/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/tools/send-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "inCoord",
          tmfBaseUrl: "http://localhost:3021/tmf-api/intentManagement/v5",
          kgTargetId: "kg-1",
          intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe(201);
    expect(body.targetUrl).toContain("/intent");
    expect(prepareIntentForToolMock).toHaveBeenCalledOnce();
    expect(sendTmf921IntentMock).toHaveBeenCalledOnce();
  });
});
