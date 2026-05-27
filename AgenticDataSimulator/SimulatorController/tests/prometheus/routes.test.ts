import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const prometheusClientMock = {
  listIntentIds: vi.fn(),
  clearIntentMetrics: vi.fn(),
  validateIntentIdForPrometheusClear: vi.fn(),
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/prometheus/client", () => prometheusClientMock);
vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
  prometheusClientMock.validateIntentIdForPrometheusClear.mockImplementation(
    (value: string) => (/^I[a-f0-9]{32}$/i.test(value) ? value : null),
  );
});

describe("prometheus routes", () => {
  it("lists intent ids for the authenticated user", async () => {
    prometheusClientMock.listIntentIds.mockResolvedValue([
      "I04fb0697e3a243e7a292c6cb57e9f797",
    ]);

    const routeModule = await import("../../src/app/api/prometheus/intents/route");
    const response = await routeModule.GET(new Request("http://localhost/api/prometheus/intents"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      intentIds: ["I04fb0697e3a243e7a292c6cb57e9f797"],
    });
  });

  it("returns 401 when listing intents without authentication", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/prometheus/intents/route");
    const response = await routeModule.GET(new Request("http://localhost/api/prometheus/intents"));

    expect(response.status).toBe(401);
  });

  it("returns 502 when Prometheus intent discovery fails", async () => {
    prometheusClientMock.listIntentIds.mockRejectedValue(
      new Error("Prometheus intent_id label query failed with 503"),
    );

    const routeModule = await import("../../src/app/api/prometheus/intents/route");
    const response = await routeModule.GET(new Request("http://localhost/api/prometheus/intents"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Prometheus intent_id label query failed with 503",
    });
  });

  it("clears metrics for a valid intent id", async () => {
    const intentId = "I04fb0697e3a243e7a292c6cb57e9f797";
    prometheusClientMock.clearIntentMetrics.mockResolvedValue({
      intentId,
      pushgatewayCleared: true,
      tsdbSeriesDeleted: true,
      tombstonesCleaned: true,
      verifiedEmpty: true,
      samplesRemaining: 0,
      oooRewriteFallbackUsed: false,
    });

    const routeModule = await import("../../src/app/api/prometheus/intents/[intentId]/empty/route");
    const response = await routeModule.POST(new Request("http://localhost/api/prometheus/intents"), {
      params: Promise.resolve({ intentId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      clearedIntentId: intentId,
      result: {
        intentId,
        pushgatewayCleared: true,
        tsdbSeriesDeleted: true,
        tombstonesCleaned: true,
        verifiedEmpty: true,
        samplesRemaining: 0,
        oooRewriteFallbackUsed: false,
      },
    });
  });

  it("returns 400 for invalid intent ids", async () => {
    const routeModule = await import("../../src/app/api/prometheus/intents/[intentId]/empty/route");
    const response = await routeModule.POST(new Request("http://localhost/api/prometheus/intents"), {
      params: Promise.resolve({ intentId: "invalid" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "intentId must be canonical I + 32 hex characters",
    });
  });

  it("returns 502 when Prometheus clear fails", async () => {
    const intentId = "I04fb0697e3a243e7a292c6cb57e9f797";
    prometheusClientMock.clearIntentMetrics.mockRejectedValue(
      new Error("Prometheus delete_series failed with 403"),
    );

    const routeModule = await import("../../src/app/api/prometheus/intents/[intentId]/empty/route");
    const response = await routeModule.POST(new Request("http://localhost/api/prometheus/intents"), {
      params: Promise.resolve({ intentId }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Prometheus delete_series failed with 403",
    });
  });
});
