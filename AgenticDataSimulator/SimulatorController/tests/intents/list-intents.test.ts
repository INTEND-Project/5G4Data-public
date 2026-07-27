import { beforeEach, describe, expect, it, vi } from "vitest";

const listIntentIdsFromGraphMock = vi.fn();
const prometheusStatusMock = {
  getPrometheusConnectionStatus: vi.fn(),
};
const prometheusClientMock = {
  listIntentIds: vi.fn(),
};

vi.mock("../../src/lib/kg/fetch-intent-turtle", () => ({
  listIntentIdsFromGraph: listIntentIdsFromGraphMock,
}));
vi.mock("../../src/lib/prometheus/status", () => prometheusStatusMock);
vi.mock("../../src/lib/prometheus/client", () => prometheusClientMock);
vi.mock("../../src/lib/intents/observation-time-bounds", () => ({
  fetchCompoundMetricsForIntent: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/intents/intent-data-readiness", () => ({
  assessIntentDataReadiness: vi.fn().mockResolvedValue({
    status: "pending",
    metricsReady: 0,
    metricsTotal: 0,
    readyCompoundMetrics: [],
    bounds: null,
  }),
}));
vi.mock("../../src/lib/kg/metric-query-metadata", () => ({
  fetchMetricQueryMetadata: vi.fn().mockResolvedValue([]),
  resolveObservationStorageFromMetadata: vi.fn().mockReturnValue("graphdb"),
}));
vi.mock("../../src/lib/grafana/intent-dashboard-url", () => ({
  buildIntentGrafanaUrl: vi.fn().mockReturnValue(null),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  prometheusStatusMock.getPrometheusConnectionStatus.mockResolvedValue(false);
});

describe("listIntentsForDomain", () => {
  it("omits registry intents that are no longer present in GraphDB or Prometheus", async () => {
    listIntentIdsFromGraphMock.mockResolvedValue([]);
    const { listIntentsForDomain } = await import("../../src/lib/intents/list-intents");

    const intents = await listIntentsForDomain(
      [
        {
          repositoryId: "repo-1",
          graphIri: "http://example/graph",
        },
      ],
      {
        ownedIntentIds: ["I04fb0697e3a243e7a292c6cb57e9f797"],
      },
    );

    expect(intents).toEqual([]);
  });

  it("keeps registry intents that still exist in GraphDB", async () => {
    listIntentIdsFromGraphMock.mockResolvedValue(["I04fb0697e3a243e7a292c6cb57e9f797"]);
    const { listIntentsForDomain } = await import("../../src/lib/intents/list-intents");

    const intents = await listIntentsForDomain(
      [
        {
          repositoryId: "repo-1",
          graphIri: "http://example/graph",
        },
      ],
      {
        ownedIntentIds: ["I04fb0697e3a243e7a292c6cb57e9f797"],
      },
    );

    expect(intents.map((entry) => entry.intentId)).toEqual([
      "I04fb0697e3a243e7a292c6cb57e9f797",
    ]);
  });

  it("keeps registry intents that exist only in Prometheus", async () => {
    listIntentIdsFromGraphMock.mockResolvedValue([]);
    prometheusStatusMock.getPrometheusConnectionStatus.mockResolvedValue(true);
    prometheusClientMock.listIntentIds.mockResolvedValue([
      "I04fb0697e3a243e7a292c6cb57e9f797",
    ]);
    const { listIntentsForDomain } = await import("../../src/lib/intents/list-intents");

    const intents = await listIntentsForDomain(
      [
        {
          repositoryId: "repo-1",
          graphIri: "http://example/graph",
        },
      ],
      {
        ownedIntentIds: ["I04fb0697e3a243e7a292c6cb57e9f797"],
      },
    );

    expect(intents.map((entry) => entry.intentId)).toEqual([
      "I04fb0697e3a243e7a292c6cb57e9f797",
    ]);
  });
});
