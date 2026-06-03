import {
  buildIntentDescriptionQuery,
  descriptionFromSparqlBindings,
} from "@/lib/kg/intent-description-query";
import { listIntentIdsFromGraph } from "@/lib/kg/fetch-intent-turtle";
import { runRepositorySparqlSelect } from "@/lib/graphdb/client";

export type KgTargetIntentListEntry = {
  intentId: string;
  description: string | null;
};

const DESCRIPTION_LOOKUP_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function lookupDescription(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
  graphDbBaseUrl?: string | null;
}): Promise<string | null> {
  let query: string;
  try {
    query = buildIntentDescriptionQuery(input.graphIri, input.intentId);
  } catch {
    return null;
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId: input.repositoryId,
      query,
      graphDbBaseUrl: input.graphDbBaseUrl,
    });
    return descriptionFromSparqlBindings(bindings);
  } catch {
    return null;
  }
}

export async function listIntentsForKgTarget(input: {
  repositoryId: string;
  graphIri: string;
  graphDbBaseUrl?: string | null;
}): Promise<KgTargetIntentListEntry[]> {
  const intentIds = await listIntentIdsFromGraph({
    repositoryId: input.repositoryId,
    graphIri: input.graphIri,
    graphDbBaseUrl: input.graphDbBaseUrl,
  });

  return mapWithConcurrency(intentIds, DESCRIPTION_LOOKUP_CONCURRENCY, async (intentId) => ({
    intentId,
    description: await lookupDescription({
      repositoryId: input.repositoryId,
      graphIri: input.graphIri,
      intentId,
      graphDbBaseUrl: input.graphDbBaseUrl,
    }),
  }));
}
