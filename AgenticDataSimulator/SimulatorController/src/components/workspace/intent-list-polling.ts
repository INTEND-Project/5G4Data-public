import { LITE_LIST_CACHE_TTL_MS } from "@/lib/intents/list-intents-cache";

/** Faster refresh while scripts or observation workers are actively running. */
export const INTENT_ACTIVE_POLL_MS = 5_000;
/** Background refresh aligned with server lite-list cache TTL. */
export const INTENT_BACKGROUND_POLL_MS = LITE_LIST_CACHE_TTL_MS;

export type IntentPollEntry = {
  intentId: string;
  dataStatus?: "pending" | "ready";
  metricsTotal?: number;
};

export function intentNeedsReadinessPoll(
  intent: IntentPollEntry,
  intentIdsAwaitingObservation: ReadonlySet<string>,
): boolean {
  if (intent.dataStatus === "ready") {
    return false;
  }

  if (intentIdsAwaitingObservation.has(intent.intentId)) {
    return true;
  }

  return (intent.metricsTotal ?? 0) > 0;
}

export function shouldPollIntentList(input: {
  intents: readonly IntentPollEntry[];
  intentIdsAwaitingObservation: ReadonlySet<string>;
  scriptRunInProgress: boolean;
  observationGenerationActive: boolean;
}): boolean {
  if (input.scriptRunInProgress || input.observationGenerationActive) {
    return true;
  }

  return input.intents.some((intent) =>
    intentNeedsReadinessPoll(intent, input.intentIdsAwaitingObservation),
  );
}

export function intentListPollIntervalMs(input: {
  scriptRunInProgress: boolean;
  observationGenerationActive: boolean;
  intentIdsAwaitingObservation: ReadonlySet<string>;
}): number {
  if (
    input.scriptRunInProgress ||
    input.observationGenerationActive ||
    input.intentIdsAwaitingObservation.size > 0
  ) {
    return INTENT_ACTIVE_POLL_MS;
  }

  return INTENT_BACKGROUND_POLL_MS;
}
