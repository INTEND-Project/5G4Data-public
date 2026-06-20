import { graphDbResponseSchema } from "../models.js";
import type { GraphDbEnvFallback, GraphTargetBinding } from "./graphTargetBinding.js";
import { graphDbAuthHeaders } from "./graphdbAuth.js";

export const DATA5G_NS = "http://5g4data.eu/5g4data#";

export const NEAREST_EDGE_DATACENTER_QUERY = `
PREFIX schema: <https://intendproject.eu/schema/>
PREFIX aeros: <https://aeros.eu/schema/>

SELECT ?datacenter ?clusterId ?location ?lat ?long
WHERE {
  GRAPH <__GRAPH__> {
    ?datacenter a schema:edgeCluster ;
                schema:latitude ?lat ;
                schema:longitude ?long .
    OPTIONAL { ?datacenter schema:clusterId ?clusterId . }
    OPTIONAL { ?datacenter aeros:location ?location . }
  }
}
`.trim();

/** GraphDB SPARQL POST target on start5g (repo base URL, not …/sparql). */
export function normalizeSparqlPostEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/sparql\/?$/i, "").replace(/\/$/, "");
}

export function extractIntentIdFromTurtle(turtle: string): string | null {
  const match = turtle.match(/\bdata5g:(I[0-9a-fA-F]{32})\b/);
  return match?.[1] ?? null;
}

function extractData5gSubjectLocals(turtle: string): string[] {
  const locals = new Set<string>();
  for (const match of turtle.matchAll(/\bdata5g:([A-Za-z0-9_]+)\s+a\b/g)) {
    locals.add(match[1]);
  }
  return [...locals];
}

function buildIntentReplaceDeleteQuery(graphIri: string, subjectIris: string[]): string {
  const values = subjectIris.map((iri) => `<${iri}>`).join(" ");
  return `
DELETE {
  GRAPH <${graphIri}> { ?s ?p ?o . }
}
WHERE {
  GRAPH <${graphIri}> {
    VALUES ?s { ${values} }
    ?s ?p ?o .
  }
}`.trim();
}

export class GraphDbTool {
  constructor(
    private readonly endpoint: string,
    private readonly namedGraph: string,
    private readonly queryLimit: number,
    private readonly repositoryBaseUrl?: string
  ) {}

  /** Infrastructure locality KG: dedicated infra repo + infra named graph. */
  static forInfrastructureLookup(
    fallback: GraphDbEnvFallback,
    queryLimit?: number
  ): GraphDbTool {
    const limit = queryLimit ?? fallback.graphDbQueryLimit;
    const infraEndpoint = fallback.graphDbInfraEndpoint || fallback.graphDbEndpoint;
    const infraNamedGraph = fallback.graphDbInfraNamedGraph || fallback.graphDbNamedGraph;
    const repoBase = normalizeSparqlPostEndpoint(infraEndpoint);
    return new GraphDbTool(repoBase, infraNamedGraph, limit, repoBase);
  }

  static fromBinding(
    binding: GraphTargetBinding | null | undefined,
    fallback: GraphDbEnvFallback,
    queryLimit?: number
  ): GraphDbTool {
    const limit = queryLimit ?? fallback.graphDbQueryLimit;
    if (binding) {
      const repoBase =
        binding.repositoryBaseUrl ?? normalizeSparqlPostEndpoint(binding.sparqlEndpoint);
      return new GraphDbTool(repoBase, binding.graphIri, limit, repoBase);
    }
    const repoBase =
      fallback.repositoryBaseUrl ?? normalizeSparqlPostEndpoint(fallback.graphDbEndpoint);
    return new GraphDbTool(
      repoBase,
      fallback.graphDbNamedGraph,
      limit,
      repoBase
    );
  }

  private repositoryQueryUrl(): string {
    return (
      this.repositoryBaseUrl?.replace(/\/$/, "") ??
      this.endpoint.replace(/\/sparql\/?$/i, "").replace(/\/$/, "")
    );
  }

  private buildQuery(): string {
    let query = NEAREST_EDGE_DATACENTER_QUERY.replace("__GRAPH__", this.namedGraph);
    if (this.queryLimit > 0) query = `${query}\nLIMIT ${this.queryLimit}`;
    return query;
  }

  async nearestEdgeCandidates(): Promise<Array<Record<string, { value: string }>>> {
    const response = await fetch(normalizeSparqlPostEndpoint(this.endpoint), {
      method: "POST",
      headers: graphDbAuthHeaders({
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded"
      }),
      body: new URLSearchParams({ query: this.buildQuery() }).toString()
    });
    if (!response.ok) {
      throw new Error(`GraphDB query failed (${response.status})`);
    }
    const payload = graphDbResponseSchema.parse(await response.json());
    return payload.results.bindings as Array<Record<string, { value: string }>>;
  }

  async deleteIntentSubjects(turtle: string): Promise<{ deleted: boolean; intentId: string | null }> {
    const graphIri = this.namedGraph.trim();
    if (!graphIri) {
      return { deleted: false, intentId: null };
    }
    const intentId = extractIntentIdFromTurtle(turtle);
    const locals = extractData5gSubjectLocals(turtle);
    if (locals.length === 0) {
      return { deleted: false, intentId };
    }
    const subjectIris = locals.map((local) => `${DATA5G_NS}${local}`);
    const query = buildIntentReplaceDeleteQuery(graphIri, subjectIris);
    const repoBase = this.repositoryQueryUrl();
    const response = await fetch(`${repoBase}/statements`, {
      method: "POST",
      headers: graphDbAuthHeaders({
        "Content-Type": "application/sparql-update"
      }),
      body: query
    });
    return { deleted: response.ok, intentId };
  }

  async insertTurtle(turtle: string): Promise<boolean> {
    const graphIri = this.namedGraph.trim();
    const repoBase = this.repositoryQueryUrl();
    const intentId = extractIntentIdFromTurtle(turtle);

    if (graphIri && intentId) {
      const deleteResult = await this.deleteIntentSubjects(turtle);
      if (!deleteResult.deleted) {
        console.warn(
          `graphdbTool.insertTurtle: replace DELETE failed for intent ${intentId}; skipping POST.`
        );
        return false;
      }
    } else if (graphIri && !intentId) {
      console.warn(
        "graphdbTool.insertTurtle: no data5g:I<32hex> intent id found; POST is additive (no DELETE)."
      );
    }

    if (graphIri) {
      const url = `${repoBase}/rdf-graphs/service?graph=${encodeURIComponent(graphIri)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: graphDbAuthHeaders({ "Content-Type": "application/x-turtle" }),
        body: turtle
      });
      return response.ok;
    }

    const statementsUrl = `${repoBase}/statements`;
    const response = await fetch(statementsUrl, {
      method: "POST",
      headers: graphDbAuthHeaders({ "Content-Type": "application/x-turtle" }),
      body: turtle
    });
    return response.ok;
  }
}
