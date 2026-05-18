import { normalizedIntentIdFromStoreResponse } from "@/lib/intent/extract-intent-turtle";

/** SPARQL 1.1 string literal escapes for VALUE / FILTER bounds. */
export function escapeSparqlStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Reject GRAPH IRI if it cannot be embedded safely in `<...>`. */
export function graphIriForSparqlAngleBrackets(graphIri: string): string {
  const t = graphIri.trim();
  if (t.length === 0) {
    throw new Error("Graph IRI is empty");
  }
  if (/[\x00-\x20<>\\]/.test(t)) {
    throw new Error("Graph IRI cannot contain spaces, angle brackets, or backslashes");
  }
  return t;
}

/**
 * Normalizes and validates canonical intent local id `I` + 32 hex for SPARQL.
 */
export function parseIntentLocalIdForMetricCatalog(raw: string): string | null {
  const n = normalizedIntentIdFromStoreResponse(raw.trim());
  return n && /^I[a-f0-9]{32}$/i.test(n) ? n : null;
}

/**
 * Metric names from BM Forum intent-shaped graphs: conditions → forAll → valuesOfTargetProperty.
 * All patterns scoped to the KG target named graph (same graph as ingest).
 */
export function buildMetricCatalogQuery(graphIriRaw: string, intentLocalIdRaw: string): string {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(intentLocalIdRaw);
  if (!intentLocalId) {
    throw new Error("Invalid intentLocalId (expected I + 32 hex)");
  }

  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const intentLit = escapeSparqlStringLiteral(intentLocalId);

  return `
PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
PREFIX set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT
  (REPLACE(REPLACE(STR(?metric), ".*[#/]", ""), "-", "_") AS ?metric_name)
WHERE {
  GRAPH <${graphIri}> {
    VALUES ?intentId { ${intentLit} }

    ?intent log:allOf ?expectation .

    FILTER(REPLACE(STR(?intent), ".*[#/]", "") = ?intentId)

    ?expectation log:allOf ?condition .

    ?condition rdf:type icm:Condition ;
               set:forAll ?metricNode .

    ?metricNode icm:valuesOfTargetProperty ?metric .
  }
}
ORDER BY ?metric_name
`.trim();
}
