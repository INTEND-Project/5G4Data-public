from __future__ import annotations

import os
from dataclasses import dataclass


def _str_to_bool(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


@dataclass(slots=True)
class AppConfig:
    """Runtime configuration for the inServ microservice."""

    host: str = "0.0.0.0"
    port: int = 3021
    log_level: str = "INFO"
    graphdb_base_url: str = "http://start5g-1.cs.uit.no:7200"
    graphdb_repository: str = "intents_and_intent_reports"
    enable_graphdb: bool = True
    infrastructure_graph: str = "http://intendproject.eu/telenor/infra"
    datacenter_base_url: str = "http://start5g-1.cs.uit.no"
    datacenter_port_base: int = 4000
    api_path: str = "/tmf-api/intentManagement/v5/"

    @classmethod
    def from_env(cls) -> "AppConfig":
        """Create an AppConfig populated from environment variables."""
        return cls(
            host=os.getenv("INSERV_HOST", "0.0.0.0"),
            port=int(os.getenv("INSERV_PORT", "3021")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            graphdb_base_url=os.getenv(
                "GRAPHDB_BASE_URL", "http://start5g-1.cs.uit.no:7200"
            ),
            graphdb_repository=os.getenv("GRAPHDB_REPOSITORY", "intents_and_intent_reports"),
            enable_graphdb=_str_to_bool(os.getenv("ENABLE_GRAPHDB"), True),
            infrastructure_graph=os.getenv(
                "INFRASTRUCTURE_GRAPH", "http://intendproject.eu/telenor/infra"
            ),
            datacenter_base_url=os.getenv(
                "DATACENTER_BASE_URL", "http://start5g-1.cs.uit.no"
            ),
            datacenter_port_base=int(os.getenv("DATACENTER_PORT_BASE", "4000")),
            api_path=os.getenv("API_PATH", "/tmf-api/intentManagement/v5/"),
        )
