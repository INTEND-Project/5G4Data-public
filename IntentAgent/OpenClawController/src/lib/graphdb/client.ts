import { loadAppEnv } from "@/lib/env";
import type {
  GraphDbNamedGraphInput,
  GraphDbRepositoryInput,
} from "@/lib/graphdb/types";

function escapeTurtleString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildRepositoryConfigTurtle(input: GraphDbRepositoryInput) {
  return `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix rep: <http://www.openrdf.org/config/repository#>.
@prefix sr: <http://www.openrdf.org/config/repository/sail#>.
@prefix sail: <http://www.openrdf.org/config/sail#>.
@prefix graphdb: <http://www.ontotext.com/config/graphdb#>.

[] a rep:Repository ;
    rep:repositoryID "${escapeTurtleString(input.repositoryId)}" ;
    rdfs:label "${escapeTurtleString(input.label)}" ;
    rep:repositoryImpl [
        rep:repositoryType "graphdb:SailRepository" ;
        sr:sailImpl [
            sail:sailType "graphdb:Sail" ;
            graphdb:read-only "false" ;
            graphdb:ruleset "rdfsplus-optimized" ;
            graphdb:disable-sameAs "true" ;
            graphdb:check-for-inconsistencies "false" ;
            graphdb:entity-id-size "32" ;
            graphdb:enable-context-index "false" ;
            graphdb:enablePredicateList "true" ;
            graphdb:enable-fts-index "false" ;
            graphdb:fts-indexes ("default" "iri") ;
            graphdb:fts-string-literals-index "default" ;
            graphdb:fts-iris-index "none" ;
            graphdb:query-timeout "0" ;
            graphdb:throw-QueryEvaluationException-on-timeout "false" ;
            graphdb:query-limit-results "0" ;
            graphdb:base-URL "http://example.org/owlim#" ;
            graphdb:defaultNS "" ;
            graphdb:imports "" ;
            graphdb:repository-type "file-repository" ;
            graphdb:storage-folder "storage" ;
            graphdb:entity-index-size "10000000" ;
            graphdb:in-memory-literal-properties "true" ;
            graphdb:enable-literal-index "true" ;
        ]
    ].`;
}

async function buildGraphDbErrorMessage(response: Response, operation: string) {
  let detail = "";

  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { message?: string };
      detail = payload.message ?? "";
    } else {
      detail = (await response.text()).trim();
    }
  } catch {
    detail = "";
  }

  return detail
    ? `GraphDB ${operation} failed with ${response.status}: ${detail}`
    : `GraphDB ${operation} failed with ${response.status}`;
}

export async function createRepository(input: GraphDbRepositoryInput) {
  const env = loadAppEnv(process.env);
  const formData = new FormData();
  const repositoryConfig = new Blob([buildRepositoryConfigTurtle(input)], {
    type: "text/turtle",
  });

  formData.append("config", repositoryConfig, "repo-config.ttl");

  const response = await fetch(`${env.graphDbBaseUrl}rest/repositories`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await buildGraphDbErrorMessage(response, "repository creation"));
  }
}

export async function createNamedGraph(input: GraphDbNamedGraphInput) {
  const env = loadAppEnv(process.env);

  const response = await fetch(
    `${env.graphDbBaseUrl}repositories/${input.repositoryId}/rdf-graphs/service?graph=${encodeURIComponent(input.graphIri)}`,
    {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
      },
      body: "",
    },
  );

  if (!response.ok) {
    throw new Error(await buildGraphDbErrorMessage(response, "named graph creation"));
  }
}

export async function deleteRepository(input: { repositoryId: string }) {
  const env = loadAppEnv(process.env);
  const response = await fetch(
    `${env.graphDbBaseUrl}rest/repositories/${encodeURIComponent(input.repositoryId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error(await buildGraphDbErrorMessage(response, "repository deletion"));
  }
}

function normalizedGraphDbBaseUrl(): string {
  const env = loadAppEnv(process.env);
  return env.graphDbBaseUrl.endsWith("/") ? env.graphDbBaseUrl : `${env.graphDbBaseUrl}/`;
}

/** POST Turtle intent data into the target named graph (RDF4J Graph Store HTTP API). */
export async function ingestIntentTurtle(input: {
  repositoryId: string;
  graphIri: string;
  turtle: string;
}): Promise<void> {
  const base = normalizedGraphDbBaseUrl();
  const url =
    `${base}repositories/${encodeURIComponent(input.repositoryId)}` +
    `/rdf-graphs/service?graph=${encodeURIComponent(input.graphIri)}`;

  const controller = new AbortController();
  const timeoutMs = 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-turtle",
      },
      body: input.turtle,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GraphDB timed out after ${timeoutMs / 1000}s during intent ingest`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(await buildGraphDbErrorMessage(response, "intent ingest"));
  }
}

type SparqlJsonBinding = Record<string, { value: string; type?: string }>;

type SparqlJsonResponse = {
  results?: {
    bindings?: SparqlJsonBinding[];
  };
};

/** POST SELECT to RDF4J/GraphDB repository root; returns `bindings` rows. */
export async function runRepositorySparqlSelect(input: {
  repositoryId: string;
  query: string;
  timeoutMs?: number;
}): Promise<SparqlJsonBinding[]> {
  const base = normalizedGraphDbBaseUrl();
  const url = `${base}repositories/${encodeURIComponent(input.repositoryId)}`;

  const timeoutMs = input.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/sparql-query",
      },
      body: input.query,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GraphDB timed out after ${timeoutMs / 1000}s during SPARQL query`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(await buildGraphDbErrorMessage(response, "SPARQL query"));
  }

  const payload = (await response.json()) as SparqlJsonResponse;
  return payload.results?.bindings ?? [];
}
