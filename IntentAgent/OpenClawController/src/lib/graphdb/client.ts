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
