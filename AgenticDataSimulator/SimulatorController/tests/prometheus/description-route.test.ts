import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const dbMock = {
  knowledgeGraphTarget: {
    findMany: vi.fn(),
  },
};

const userIntentRegistryMock = {
  assertUserOwnsIntent: vi.fn(),
};

const lookupIntentDescriptionMock = vi.fn();

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({
  db: dbMock,
}));

vi.mock("../../src/lib/intents/user-intent-registry", () => userIntentRegistryMock);

vi.mock("../../src/lib/kg/lookup-intent-description", () => ({
  lookupIntentDescription: lookupIntentDescriptionMock,
}));

vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
  userIntentRegistryMock.assertUserOwnsIntent.mockResolvedValue(true);
});

describe("GET /api/prometheus/intents/[intentId]/description", () => {
  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import(
      "../../src/app/api/prometheus/intents/[intentId]/description/route"
    );
    const response = await routeModule.GET(
      new Request(
        "http://localhost/api/prometheus/intents/I04fb0697e3a243e7a292c6cb57e9f797/description?domain=telenor.5g4data",
      ),
      {
        params: Promise.resolve({
          intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns intent description from GraphDB lookup", async () => {
    dbMock.knowledgeGraphTarget.findMany.mockResolvedValue([
      {
        repositoryId: "repo-1",
        graphIri: "urn:intend:kg:telenor-5g4data:demo",
      },
    ]);
    lookupIntentDescriptionMock.mockResolvedValue(
      "Deploy a small LLM inference service near Tromsø with sustainable operation.",
    );

    const routeModule = await import(
      "../../src/app/api/prometheus/intents/[intentId]/description/route"
    );
    const response = await routeModule.GET(
      new Request(
        "http://localhost/api/prometheus/intents/I04fb0697e3a243e7a292c6cb57e9f797/description?domain=telenor.5g4data",
      ),
      {
        params: Promise.resolve({
          intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      description: "Deploy a small LLM inference service near Tromsø with sustainable operation.",
    });
  });
});
