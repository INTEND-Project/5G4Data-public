import { INTENT_REPORTS_METADATA_GRAPH_IRI } from "@/lib/graphdb/clear-knowledge-graph-query";
import { graphIriForSparqlAngleBrackets } from "@/lib/kg/metric-catalog-query";

function metricIri(localName: string): string {
  return `<http://5g4data.eu/5g4data#${localName}>`;
}

export function buildClearIntentObservationsUpdate(
  graphIriRaw: string,
  compoundMetrics: string[],
): string {
  if (compoundMetrics.length === 0) {
    throw new Error("compoundMetrics must not be empty");
  }

  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const metadataGraphIri = graphIriForSparqlAngleBrackets(INTENT_REPORTS_METADATA_GRAPH_IRI);
  const metricValues = compoundMetrics.map((name) => metricIri(name)).join(" ");
  const metadataSubjects = compoundMetrics
    .map((name) => `<http://5g4data.eu/5g4data#${name}>`)
    .join(" ");

  return `
PREFIX met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/>

DELETE {
  GRAPH <${graphIri}> {
    ?obs ?p ?o .
  }
  GRAPH <${metadataGraphIri}> {
    ?meta ?mp ?mo .
  }
}
WHERE {
  GRAPH <${graphIri}> {
    ?obs a met:Observation ;
         met:observedMetric ?metric .
    VALUES ?metric { ${metricValues} }
    ?obs ?p ?o .
  }
  OPTIONAL {
    GRAPH <${metadataGraphIri}> {
      VALUES ?meta { ${metadataSubjects} }
      ?meta ?mp ?mo .
    }
  }
}
`.trim();
}
