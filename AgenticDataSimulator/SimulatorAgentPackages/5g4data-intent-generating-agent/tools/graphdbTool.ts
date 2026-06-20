import { graphDbResponseSchema } from "../models.js";
import type { GraphDbEnvFallback } from "./graphTargetBinding.js";
import { graphDbAuthHeaders } from "./graphdbAuth.js";

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

/** GraphDB SPARQL POST target (repository base URL, not …/sparql). */
export function normalizeGraphDbPostEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/sparql\/?$/i, "").replace(/\/$/, "");
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
    const repoBase = normalizeGraphDbPostEndpoint(infraEndpoint);
    return new GraphDbTool(repoBase, infraNamedGraph, limit, repoBase);
  }

  private buildQuery(): string {
    let query = NEAREST_EDGE_DATACENTER_QUERY.replace("__GRAPH__", this.namedGraph);
    if (this.queryLimit > 0) query = `${query}\nLIMIT ${this.queryLimit}`;
    return query;
  }

  async nearestEdgeCandidates(): Promise<Array<Record<string, { value: string }>>> {
    const response = await fetch(normalizeGraphDbPostEndpoint(this.endpoint), {
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

  async insertTurtle(turtle: string): Promise<boolean> {
    const statementsUrl = `${normalizeGraphDbPostEndpoint(this.endpoint)}/statements`;
    const response = await fetch(statementsUrl, {
      method: "POST",
      headers: graphDbAuthHeaders({ "Content-Type": "application/x-turtle" }),
      body: turtle
    });
    return response.ok;
  }
}
