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
    return this.repositoryBaseUrl?.replace(/\/$/, "") ?? this.endpoint.replace(/\/sparql\/?$/i, "").replace(/\/$/, "");
  }

  /** GraphDB REST `/repositories/{id}/statements` (Intent-Simulator `graphdb_client`). */
  private statementsEndpoint(): string {
    return `${this.repositoryQueryUrl()}/statements`;
  }

  /** Repository id from binding URL, e.g. `.../repositories/intent-reports/sparql` → `intent-reports`. */
  private repositoryId(): string {
    const fromUrl = (url: string): string | null => {
      const m = url.match(/\/repositories\/([^/?#]+)/i);
      return m?.[1] ?? null;
    };
    return (
      fromUrl(this.repositoryBaseUrl ?? "") ??
      fromUrl(this.endpoint) ??
      process.env.GRAPHDB_REPOSITORY?.trim() ??
      "intent-reports"
    );
  }

  /** GraphDB server root, e.g. `http://host:7200`. */
  private graphDbServerBaseUrl(): string {
    const repoUrl = this.repositoryQueryUrl();
    const idx = repoUrl.search(/\/repositories\//i);
    return idx >= 0 ? repoUrl.slice(0, idx).replace(/\/$/, "") : repoUrl.replace(/\/$/, "");
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

  /**
   * Store Prometheus query metadata for a metric in the metadata graph
   * (Intent-Simulator `GraphDbClient.store_prometheus_metadata`).
   */
  async storePrometheusMetadata(
    metricName: string,
    prometheusUrl = process.env.PROMETHEUS_URL?.trim() || "http://start5g-1.cs.uit.no:9090"
  ): Promise<boolean> {
    try {
      const readableQuery = `${metricName}{job="intent_reports"}`;
      const encodedQuery = encodeURIComponent(readableQuery);
      const prometheusQueryUrl = `${prometheusUrl.replace(/\/$/, "")}/api/v1/query?query=${encodedQuery}`;
      const escapedReadableQuery = readableQuery.replace(/"/g, '\\"');

      const insertQuery = `
PREFIX data5g: <http://5g4data.eu/5g4data#>

INSERT DATA {
  GRAPH <http://intent-reports-metadata> {
    data5g:${metricName}
      data5g:hasQuery <${prometheusQueryUrl}> ;
      data5g:hasReadableQuery "${escapedReadableQuery}" .
  }
}
`.trim();

      const response = await fetch(this.statementsEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/sparql-update" },
        body: insertQuery
      });
      if (!response.ok) return false;
      return response.status === 204 || response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Store GraphDB query metadata for a metric in the metadata graph
   * (Intent-Simulator `GraphDbClient.store_graphdb_metadata`).
   */
  async storeGraphdbMetadata(
    metricName: string,
    graphdbUrl?: string
  ): Promise<boolean> {
    try {
      const repository = this.repositoryId();
      const serverBase = (graphdbUrl ?? this.graphDbServerBaseUrl()).replace(/\/$/, "");

      const sparqlQuery = `
PREFIX met:  <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX data5g: <http://5g4data.eu/5g4data#>
PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
PREFIX imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/>
PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
PREFIX set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/>

SELECT ?unit ?value ?timestamp
WHERE {
  SERVICE <repository:${repository}> {
    BIND(IRI(CONCAT("http://5g4data.eu/5g4data#", "${metricName}")) AS ?metric)

    ?observation a met:Observation ;
            met:observedMetric ?metric ;
            met:observedValue ?blankValue ;
            met:obtainedAt ?timestamp .

    ?blankValue rdf:value ?rawValue ;
            quan:unit ?unit .

    BIND(xsd:decimal(?rawValue) AS ?value)
  }
}
ORDER BY ?timestamp
`;

      const encodedQuery = encodeURIComponent(sparqlQuery);
      const graphdbQueryUrl = `${serverBase}/repositories/${repository}?query=${encodedQuery}`;

      const insertQuery = `
PREFIX data5g: <http://5g4data.eu/5g4data#>

INSERT DATA {
  GRAPH <http://intent-reports-metadata> {
    <http://5g4data.eu/5g4data#${metricName}>
      data5g:hasQuery <${graphdbQueryUrl}> .
  }
}
`.trim();

      const response = await fetch(this.statementsEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/sparql-update" },
        body: insertQuery
      });
      if (!response.ok) return false;
      return response.status === 204 || response.ok;
    } catch {
      return false;
    }
  }
}
