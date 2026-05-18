import type { GraphDbEnvFallback, GraphTargetBinding } from "./graphTargetBinding.js";

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

export class GraphDbTool {
  constructor(
    private readonly endpoint: string,
    private readonly namedGraph: string,
    private readonly queryLimit: number,
    private readonly repositoryBaseUrl?: string
  ) {}

  static fromEnv(env: GraphDbEnvFallback): GraphDbTool {
    return new GraphDbTool(
      env.graphDbEndpoint,
      env.graphDbNamedGraph,
      env.graphDbQueryLimit,
      env.repositoryBaseUrl
    );
  }

  static fromBinding(
    binding: GraphTargetBinding | null | undefined,
    fallback: GraphDbEnvFallback,
    queryLimit?: number
  ): GraphDbTool {
    const limit = queryLimit ?? fallback.graphDbQueryLimit;
    if (binding) {
      const repoBase =
        binding.repositoryBaseUrl ?? binding.sparqlEndpoint.replace(/\/sparql\/?$/i, "");
      return new GraphDbTool(binding.sparqlEndpoint, binding.graphIri, limit, repoBase);
    }
    const repoBase = fallback.graphDbEndpoint.replace(/\/sparql\/?$/i, "");
    return new GraphDbTool(
      fallback.graphDbEndpoint,
      fallback.graphDbNamedGraph,
      limit,
      repoBase
    );
  }

  /**
   * Intent-Simulator `graphdb_client.get_intent()` uses
   * `<http://5g4data.eu/5g4data#I{uuid}>` where `uuid` is 32 hex chars (optional leading `I` in input).
   */
  private intentRootUri(intentId: string): string | null {
    const id = intentId.trim();
    if (/^https?:\/\//i.test(id)) {
      try {
        return new URL(id).toString();
      } catch {
        return null;
      }
    }
    const hex = id.replace(/^I/i, "");
    if (!/^[a-f0-9]{32}$/i.test(hex)) {
      return null;
    }
    return `http://5g4data.eu/5g4data#I${hex.toLowerCase()}`;
  }

  /** POST SPARQL to repository root (same as Python client), not necessarily .../sparql. */
  private repositoryQueryUrl(): string {
    return this.endpoint.replace(/\/sparql\/?$/i, "").replace(/\/$/, "");
  }

  private buildQuery(query: string): string {
    let resolved = query.replace("__GRAPH__", this.namedGraph);
    if (this.queryLimit > 0) resolved = `${resolved}\nLIMIT ${this.queryLimit}`;
    return resolved;
  }

  async nearestEdgeCandidates(): Promise<Array<Record<string, { value: string }>>> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query: this.buildQuery(NEAREST_EDGE_DATACENTER_QUERY) }).toString()
    });
    if (!response.ok) {
      throw new Error(`GraphDB query failed (${response.status})`);
    }
    const payload = (await response.json()) as {
      results?: { bindings?: Array<Record<string, { value: string }>> };
    };
    return payload.results?.bindings ?? [];
  }

  async getIntentTurtle(intentId: string): Promise<string | null> {
    const root = this.intentRootUri(intentId);
    if (!root) return null;

    const graphClause = this.namedGraph.trim()
      ? `GRAPH <${this.namedGraph}> {
  ?s ?p ?o .
  <${root}> (^!rdf:type|!rdf:type)* ?s .
  FILTER(?p != rdf:type || ?o != rdf:List)
}`
      : `?s ?p ?o .
  <${root}> (^!rdf:type|!rdf:type)* ?s .
  FILTER(?p != rdf:type || ?o != rdf:List)`;

    const query = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX data5g: <http://5g4data.eu/5g4data#>
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
PREFIX set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/>
PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/>

CONSTRUCT {
  ?s ?p ?o .
}
WHERE {
  ${graphClause}
}
`.trim();

    const response = await fetch(this.repositoryQueryUrl(), {
      method: "POST",
      headers: { Accept: "text/turtle", "Content-Type": "application/sparql-query" },
      body: query
    });
    if (!response.ok) return null;
    const ttl = await response.text();
    return ttl.trim().length > 0 ? ttl : null;
  }

  async insertTurtle(turtle: string): Promise<boolean> {
    const graphIri = this.namedGraph.trim();
    const repoBase = (this.repositoryBaseUrl ?? this.repositoryQueryUrl()).replace(/\/$/, "");

    if (graphIri) {
      const url = `${repoBase}/rdf-graphs/service?graph=${encodeURIComponent(graphIri)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-turtle" },
        body: turtle
      });
      return response.ok;
    }

    const statementsUrl = `${repoBase}/statements`;
    const response = await fetch(statementsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-turtle" },
      body: turtle
    });
    return response.ok;
  }
}
