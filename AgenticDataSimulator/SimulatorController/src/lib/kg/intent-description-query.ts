import {
  escapeSparqlStringLiteral,
  graphIriForSparqlAngleBrackets,
  parseIntentLocalIdForMetricCatalog,
} from "@/lib/kg/metric-catalog-query";

export function buildIntentDescriptionQuery(
  graphIriRaw: string,
  intentLocalIdRaw: string,
): string {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(intentLocalIdRaw);
  if (!intentLocalId) {
    throw new Error("Invalid intentLocalId (expected I + 32 hex)");
  }

  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const intentLit = escapeSparqlStringLiteral(intentLocalId);

  return `
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT ?description
WHERE {
  GRAPH <${graphIri}> {
    ?intent a icm:Intent ;
            dct:description ?description .

    FILTER(REPLACE(STR(?intent), ".*[#/]", "") = ${intentLit})
  }
}
LIMIT 1
`.trim();
}

export function descriptionFromSparqlBindings(
  bindings: Array<Record<string, { value: string }>>,
): string | null {
  for (const row of bindings) {
    const cell = row.description;
    const value = cell?.value?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}
