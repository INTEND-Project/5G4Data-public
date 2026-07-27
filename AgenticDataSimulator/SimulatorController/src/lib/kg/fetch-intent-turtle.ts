import { graphDbAuthHeaders } from "@/lib/graphdb/auth";
import { prettyPrintIntentTurtle } from "@/lib/kg/pretty-print-intent-turtle";
import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import { resolveGraphDbBaseUrl } from "@/lib/graphdb/resolve-base-url";
import {
  graphIriForSparqlAngleBrackets,
  parseIntentLocalIdForMetricCatalog,
} from "@/lib/kg/metric-catalog-query";

function intentRootUri(intentId: string): string | null {
  const id = intentId.trim();
  const hex = id.replace(/^I/i, "");
  if (!/^[a-f0-9]{32}$/i.test(hex)) {
    return null;
  }

  return `http://5g4data.eu/5g4data#I${hex.toLowerCase()}`;
}

export function buildFetchIntentTurtleConstructQuery(
  graphIriRaw: string,
  intentLocalIdRaw: string,
): string {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(intentLocalIdRaw);
  if (!intentLocalId) {
    throw new Error("Invalid intentLocalId (expected I + 32 hex)");
  }

  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const root = intentRootUri(intentLocalId);
  if (!root) {
    throw new Error("Invalid intentLocalId (expected I + 32 hex)");
  }

  return `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

CONSTRUCT {
  ?s ?p ?o .
}
WHERE {
  GRAPH <${graphIri}> {
    ?s ?p ?o .
    <${root}> (^!rdf:type|!rdf:type)* ?s .
    FILTER(?p != rdf:type || ?o != rdf:List)
  }
}
`.trim();
}

export async function fetchIntentTurtle(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
  graphDbBaseUrl?: string | null;
}): Promise<string | null> {
  let query: string;
  try {
    query = buildFetchIntentTurtleConstructQuery(input.graphIri, input.intentId);
  } catch {
    return null;
  }

  const normalizedBase = resolveGraphDbBaseUrl(input.graphDbBaseUrl);
  const url = `${normalizedBase}repositories/${encodeURIComponent(input.repositoryId)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: graphDbAuthHeaders({
      Accept: "text/turtle",
      "Content-Type": "application/sparql-query",
    }),
    body: query,
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const raw = (await response.text()).trim();
  if (raw.length === 0) {
    return null;
  }
  return prettyPrintIntentTurtle(raw);
}

export async function listIntentIdsFromGraph(input: {
  repositoryId: string;
  graphIri: string;
  graphDbBaseUrl?: string | null;
}): Promise<string[]> {
  const { buildListIntentsQuery } = await import("@/lib/kg/list-intents-query");
  let query: string;
  try {
    query = buildListIntentsQuery(input.graphIri);
  } catch {
    return [];
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId: input.repositoryId,
      query,
      graphDbBaseUrl: input.graphDbBaseUrl,
    });

    const ids = bindings
      .map((row) => row.intent_id?.value?.trim())
      .filter((value): value is string => Boolean(value));

    return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
