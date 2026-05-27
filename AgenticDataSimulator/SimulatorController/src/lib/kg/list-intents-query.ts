import { graphIriForSparqlAngleBrackets } from "@/lib/kg/metric-catalog-query";

export function buildListIntentsQuery(graphIriRaw: string): string {
  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);

  return `
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>

SELECT DISTINCT (REPLACE(STR(?intent), ".*[#/]", "") AS ?intent_id)
WHERE {
  GRAPH <${graphIri}> {
    ?intent a icm:Intent .
  }
}
ORDER BY ?intent_id
`.trim();
}
