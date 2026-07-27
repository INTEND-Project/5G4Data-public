import { describe, expect, it } from "vitest";

import {
  MAX_OBSERVATION_LOOKBACK_MS,
  clampBoundsForGrafana,
  earliestObservationLookbackMs,
  historicGrafanaWindow,
} from "../../src/lib/intents/observation-time-bounds";
import { buildGrafanaTimeParams } from "../../src/lib/grafana/intent-dashboard-url";

describe("observation lookback cap", () => {
  const nowMs = Date.UTC(2026, 4, 27, 12, 0, 0);

  it("defines a six-month lookback window", () => {
    expect(MAX_OBSERVATION_LOOKBACK_MS).toBe(183 * 24 * 60 * 60 * 1000);
    expect(earliestObservationLookbackMs(nowMs)).toBe(nowMs - MAX_OBSERVATION_LOOKBACK_MS);
  });

  it("clamps bounds minMs to the lookback floor", () => {
    const bounds = clampBoundsForGrafana(
      {
        minMs: Date.UTC(2020, 0, 1),
        maxMs: nowMs - 60_000,
      },
      nowMs,
    );

    expect(bounds.minMs).toBe(earliestObservationLookbackMs(nowMs));
    expect(bounds.maxMs).toBe(nowMs - 60_000);
  });

  it("caps historic grafana windows at six months", () => {
    const window = historicGrafanaWindow(
      {
        minMs: Date.UTC(2020, 0, 1),
        maxMs: nowMs - 60_000,
      },
      nowMs,
    );

    expect(window.fromMs).toBeGreaterThanOrEqual(earliestObservationLookbackMs(nowMs));
  });

  it("applies the lookback floor in buildGrafanaTimeParams", () => {
    const nowMs = Date.now();
    const time = buildGrafanaTimeParams({
      minMs: nowMs - MAX_OBSERVATION_LOOKBACK_MS - 86_400_000,
      maxMs: nowMs - 86_400_000,
    });

    expect(Number(time.from)).toBeGreaterThanOrEqual(earliestObservationLookbackMs(nowMs));
  });
});
