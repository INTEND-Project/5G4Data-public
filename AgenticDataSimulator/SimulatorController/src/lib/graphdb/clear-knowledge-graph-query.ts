import { graphIriForSparqlAngleBrackets } from "@/lib/kg/metric-catalog-query";

export const INTENT_REPORTS_METADATA_GRAPH_IRI = "http://intent-reports-metadata";

export function buildClearKnowledgeGraphUpdate(graphIriRaw: string): string {
  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const metadataGraphIri = graphIriForSparqlAngleBrackets(INTENT_REPORTS_METADATA_GRAPH_IRI);

  return `CLEAR DEFAULT ;
CLEAR GRAPH <${metadataGraphIri}> ;
CLEAR GRAPH <${graphIri}> ;`;
}
