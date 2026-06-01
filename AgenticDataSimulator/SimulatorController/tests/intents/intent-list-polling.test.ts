import { describe, expect, it } from "vitest";

import {
  INTENT_ACTIVE_POLL_MS,
  INTENT_BACKGROUND_POLL_MS,
  intentListPollIntervalMs,
  intentNeedsReadinessPoll,
  shouldPollIntentList,
} from "../../src/components/workspace/intent-list-polling";

describe("intentNeedsReadinessPoll", () => {
  it("ignores ready intents", () => {
    expect(
      intentNeedsReadinessPoll(
        { intentId: "I1", dataStatus: "ready", metricsTotal: 3 },
        new Set(),
      ),
    ).toBe(false);
  });

  it("polls intents with known metric totals", () => {
    expect(
      intentNeedsReadinessPoll(
        { intentId: "I1", dataStatus: "pending", metricsTotal: 2 },
        new Set(),
      ),
    ).toBe(true);
  });

  it("polls intents awaiting observation even without metric totals", () => {
    expect(
      intentNeedsReadinessPoll(
        { intentId: "I1", dataStatus: "pending", metricsTotal: 0 },
        new Set(["I1"]),
      ),
    ).toBe(true);
  });

  it("does not poll stale pending intents with no metric totals", () => {
    expect(
      intentNeedsReadinessPoll(
        { intentId: "I1", dataStatus: "pending", metricsTotal: 0 },
        new Set(),
      ),
    ).toBe(false);
  });
});

describe("shouldPollIntentList", () => {
  it("polls while scripts or observation generation are active", () => {
    expect(
      shouldPollIntentList({
        intents: [],
        intentIdsAwaitingObservation: new Set(),
        scriptRunInProgress: true,
        observationGenerationActive: false,
      }),
    ).toBe(true);
  });

  it("stops when all intents are ready and nothing is running", () => {
    expect(
      shouldPollIntentList({
        intents: [{ intentId: "I1", dataStatus: "ready", metricsTotal: 2 }],
        intentIdsAwaitingObservation: new Set(),
        scriptRunInProgress: false,
        observationGenerationActive: false,
      }),
    ).toBe(false);
  });
});

describe("intentListPollIntervalMs", () => {
  it("uses fast polling during active work", () => {
    expect(
      intentListPollIntervalMs({
        scriptRunInProgress: true,
        observationGenerationActive: false,
        intentIdsAwaitingObservation: new Set(),
      }),
    ).toBe(INTENT_ACTIVE_POLL_MS);
  });

  it("uses slow polling for passive pending intents", () => {
    expect(
      intentListPollIntervalMs({
        scriptRunInProgress: false,
        observationGenerationActive: false,
        intentIdsAwaitingObservation: new Set(),
      }),
    ).toBe(INTENT_BACKGROUND_POLL_MS);
  });
});
