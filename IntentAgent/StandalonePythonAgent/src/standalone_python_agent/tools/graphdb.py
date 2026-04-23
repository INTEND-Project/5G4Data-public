from __future__ import annotations

from typing import Any

import httpx


NEAREST_EDGE_DATACENTER_QUERY = """
PREFIX schema: <https://intendproject.eu/schema/>
PREFIX aeros: <https://aeros.eu/schema/>

SELECT ?datacenter ?clusterId ?location ?lat ?long
WHERE {{
  GRAPH <{graph}> {{
    ?datacenter a schema:edgeCluster ;
                schema:latitude ?lat ;
                schema:longitude ?long .
    OPTIONAL {{ ?datacenter schema:clusterId ?clusterId . }}
    OPTIONAL {{ ?datacenter aeros:location ?location . }}
  }}
}}
""".strip()


class GraphDBClient:
    def __init__(
        self,
        endpoint: str,
        named_graph: str,
        query_limit: int = 0,
        timeout: float = 20.0,
    ) -> None:
        self.endpoint = endpoint
        self.named_graph = named_graph
        self.query_limit = query_limit
        self.timeout = timeout

    def run_select(self, query: str) -> dict[str, Any]:
        response = httpx.post(
            self.endpoint,
            data={"query": query},
            headers={"Accept": "application/sparql-results+json"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def nearest_edge_candidates(self) -> dict[str, Any]:
        query = NEAREST_EDGE_DATACENTER_QUERY.format(graph=self.named_graph)
        if self.query_limit > 0:
            query = f"{query}\nLIMIT {self.query_limit}"
        return self.run_select(query)
