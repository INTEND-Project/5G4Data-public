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
    # Absolute or relative path to the main application log file.
    # When not set, logging falls back to stdout only.
    log_file_path: str = "logs/inserv.log"
    graphdb_base_url: str = "http://start5g-1.cs.uit.no:7200"
    graphdb_repository: str = "intents_and_intent_reports"
    enable_graphdb: bool = True
    infrastructure_graph: str = "http://intendproject.eu/telenor/infra"
    datacenter_base_url: str = "http://start5g-1.cs.uit.no"
    datacenter_port_base: int = 4000
    api_path: str = "/tmf-api/intentManagement/v5/"
    innet_base_url: str = "http://intend.eu/inNet"
    # When enabled, inServ will not forward intents to inOrch-TMF-Proxy
    # but will only log that they were received.
    test_mode: bool = False
    # When False, inServ will not forward intents to inNet but will still
    # log as if they were being sent (useful when inNet is not available).
    innet_ready: bool = True
    # Enable the internal /logs HTTP endpoint for browsing recent logs.
    enable_log_endpoint: bool = False

    @classmethod
    def from_env(cls) -> "AppConfig":
        """Create an AppConfig populated from environment variables."""
        return cls(
            host=os.getenv("INSERV_HOST", "0.0.0.0"),
            port=int(os.getenv("INSERV_PORT", "3021")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            log_file_path=os.getenv("INSERV_LOG_FILE", "logs/inserv.log"),
            graphdb_base_url=os.getenv(
                "GRAPHDB_BASE_URL", "http://start5g-1.cs.uit.no:7200"
            ),
            graphdb_repository=os.getenv("GRAPHDB_REPOSITORY", "intents_and_intent_reports"),
            enable_graphdb=_str_to_bool(os.getenv("ENABLE_GRAPHDB"), True),
            test_mode=_str_to_bool(os.getenv("INSERV_TEST_MODE"), False),
            innet_ready=_str_to_bool(os.getenv("INSERV_INNET_READY"), True),
            enable_log_endpoint=_str_to_bool(os.getenv("ENABLE_LOG_ENDPOINT"), False),
            infrastructure_graph=os.getenv(
                "INFRASTRUCTURE_GRAPH", "http://intendproject.eu/telenor/infra"
            ),
            datacenter_base_url=os.getenv(
                "DATACENTER_BASE_URL", "http://start5g-1.cs.uit.no"
            ),
            datacenter_port_base=int(os.getenv("DATACENTER_PORT_BASE", "4000")),
            api_path=os.getenv("API_PATH", "/tmf-api/intentManagement/v5/"),
            innet_base_url=os.getenv("INNET_BASE_URL", "http://intend.eu/inNet"),
        )
