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

describe("POST /api/tools/preview-intent", () => {
  it("returns turtle and payload without calling sendTmf921Intent", async () => {
    const turtle = '@prefix imo: <> .\nimo:handler "inSustain" .';
    prepareIntentForToolMock.mockResolvedValue({
      intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toolId: "inSustain",
      turtle,
      payload: {
        "@type": "Intent",
        name: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        description: "desc",
        expression: {
          "@type": "TurtleExpression",
          iri: "https://5g4data.eu/intent/Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          expressionValue: turtle,
        },
      },
    });

    const routeModule = await import("../../src/app/api/tools/preview-intent/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/tools/preview-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId: "inSustain",
          kgTargetId: "kg-1",
          intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.turtle).toBe(turtle);
    expect(body.payload.expression.expressionValue).toBe(turtle);
    expect(sendTmf921IntentMock).not.toHaveBeenCalled();
  });
});
