import { extractCompoundMetricNamesFromIntentTurtle } from "@intent-obs-package/tools/intentMetricExtraction";
import { fetchIntentTurtle } from "@/lib/kg/fetch-intent-turtle";
import { parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";

/** Resolve compound metric names from pretty-printed intent Turtle (shape-tolerant). */
export async function resolveIntentMetricCatalog(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
  graphDbBaseUrl?: string | null;
}): Promise<string[]> {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(input.intentId);
  if (!intentLocalId) {
    return [];
  }

  const turtle = await fetchIntentTurtle({
    repositoryId: input.repositoryId,
    graphIri: input.graphIri,
    intentId: intentLocalId,
    graphDbBaseUrl: input.graphDbBaseUrl,
  });

  if (!turtle) {
    return [];
  }

  return extractCompoundMetricNamesFromIntentTurtle(turtle).sort((a, b) => a.localeCompare(b));
}
