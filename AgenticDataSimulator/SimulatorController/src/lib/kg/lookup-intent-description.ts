import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import {
  buildIntentDescriptionQuery,
  descriptionFromSparqlBindings,
} from "@/lib/kg/intent-description-query";
import { parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";

type KgTargetRef = {
  repositoryId: string;
  graphIri: string;
};

export async function lookupIntentDescription(
  targets: KgTargetRef[],
  intentLocalIdRaw: string,
): Promise<string | null> {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(intentLocalIdRaw);
  if (!intentLocalId) {
    throw new Error("intentId must be canonical I + 32 hex characters");
  }

  for (const target of targets) {
    let query: string;
    try {
      query = buildIntentDescriptionQuery(target.graphIri, intentLocalId);
    } catch {
      continue;
    }

    try {
      const bindings = await runRepositorySparqlSelect({
        repositoryId: target.repositoryId,
        query,
      });
      const description = descriptionFromSparqlBindings(bindings);
      if (description) {
        return description;
      }
    } catch {
      continue;
    }
  }

  return null;
}
