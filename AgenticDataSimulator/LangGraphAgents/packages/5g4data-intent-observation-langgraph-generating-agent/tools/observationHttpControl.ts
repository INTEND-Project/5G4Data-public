import { readRecentObservationErrors } from "./observationLog.js";
import { getObservationProgressResponse } from "./observationProgress.js";

export function handleObservationProgressHttp(intentId: string): Record<string, unknown> {
  return getObservationProgressResponse(intentId.trim());
}

export function handleObservationErrorsHttp(input?: {
  since?: string;
  limit?: number;
}): { errors: ReturnType<typeof readRecentObservationErrors> } {
  let sinceMs: number | undefined;
  if (input?.since) {
    const parsed = Date.parse(input.since);
    if (Number.isFinite(parsed)) {
      sinceMs = parsed;
    }
  }
  const limit = input?.limit ?? 50;
  return {
    errors: readRecentObservationErrors({ sinceMs, limit }),
  };
}
