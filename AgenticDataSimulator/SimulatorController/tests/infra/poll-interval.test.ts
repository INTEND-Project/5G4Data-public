import { describe, expect, it } from "vitest";

import {
  CONNECTED_POLL_MS,
  DISCONNECTED_POLL_MS,
  infraPollIntervalMs,
  registryPollIntervalMs,
} from "../../src/components/workspace/infra-connection-status";

describe("infraPollIntervalMs", () => {
  it("uses fast polling when any service is disconnected", () => {
    expect(
      infraPollIntervalMs({
        registryConnected: false,
        graphDbConnected: true,
        prometheusConnected: true,
      }),
    ).toBe(DISCONNECTED_POLL_MS);

    expect(
      infraPollIntervalMs({
        registryConnected: true,
        graphDbConnected: false,
        prometheusConnected: true,
      }),
    ).toBe(DISCONNECTED_POLL_MS);

    expect(
      infraPollIntervalMs({
        registryConnected: true,
        graphDbConnected: true,
        prometheusConnected: false,
      }),
    ).toBe(DISCONNECTED_POLL_MS);
  });

  it("uses slow polling when all services are connected", () => {
    expect(
      infraPollIntervalMs({
        registryConnected: true,
        graphDbConnected: true,
        prometheusConnected: true,
      }),
    ).toBe(CONNECTED_POLL_MS);
  });
});

describe("registryPollIntervalMs", () => {
  it("does not poll when the registry is connected", () => {
    expect(registryPollIntervalMs(true)).toBeNull();
  });

  it("uses fast polling when the registry is disconnected", () => {
    expect(registryPollIntervalMs(false)).toBe(DISCONNECTED_POLL_MS);
  });
});
