import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const registerUserIntentMock = vi.fn();

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/intents/user-intent-registry", () => ({
  registerUserIntent: registerUserIntentMock,
}));

vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
  registerUserIntentMock.mockResolvedValue(undefined);
});

describe("POST /api/intents/register", () => {
  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/intents/register/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/intents/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "telenor.5g4data",
          intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("registers an intent for the authenticated user", async () => {
    const routeModule = await import("../../src/app/api/intents/register/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/intents/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "telenor.5g4data",
          intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
          storage: "prometheus",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(registerUserIntentMock).toHaveBeenCalledWith({
      userId: "user-1",
      domain: "telenor.5g4data",
      intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
      storage: "prometheus",
      graphTargetId: undefined,
    });
  });
});
