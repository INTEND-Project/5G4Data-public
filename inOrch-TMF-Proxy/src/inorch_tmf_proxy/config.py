from __future__ import annotations

import os
from dataclasses import dataclass


def _str_to_bool(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


@dataclass(slots=True)
class AppConfig:
    """Runtime configuration for the inOrch-TMF-Proxy microservice."""

    host: str = "0.0.0.0"
    port: int = 3020
    log_level: str = "INFO"
    kube_namespace: str = "default"
    workload_image: str = "busybox:stable"
    workload_pull_policy: str = "IfNotPresent"
    workload_service_account: str = "default"
    enable_k8s: bool = True
    reporting_handler: str = "inOrch-TMF-Proxy"
    reporting_owner: str | None = None
    enable_observation_reports: bool = True
    observation_interval_seconds: int = 300
    observation_metric_name: str = "intent_latency_ms"
    graphdb_base_url: str = "http://start5g-1.cs.uit.no:7200"
    graphdb_repository: str = "intents_and_intent_reports"
    enable_graphdb: bool = True
    observation_reporting_enabled: bool = True
    observation_reporting_frequency: int = 30  # Default frequency in seconds
    prometheus_query_timeout: int = 10  # Timeout for Prometheus queries in seconds
    prometheus_retry_attempts: int = 3  # Number of retry attempts for Prometheus queries

    @classmethod
    def from_env(cls) -> "AppConfig":
        """Create an AppConfig populated from environment variables."""
        return cls(
            host=os.getenv("INSERV_HOST", "0.0.0.0"),
            port=int(os.getenv("INSERV_PORT", "3020")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            kube_namespace=os.getenv("KUBE_NAMESPACE", "default"),
            workload_image=os.getenv("WORKLOAD_IMAGE", "busybox:stable"),
            workload_pull_policy=os.getenv("WORKLOAD_PULL_POLICY", "IfNotPresent"),
            workload_service_account=os.getenv(
                "WORKLOAD_SERVICE_ACCOUNT", "default"
            ),
            enable_k8s=_str_to_bool(os.getenv("ENABLE_K8S"), True),
            reporting_handler=os.getenv("REPORTING_HANDLER", "inOrch-TMF-Proxy"),
            reporting_owner=os.getenv("REPORTING_OWNER"),
            enable_observation_reports=_str_to_bool(
                os.getenv("ENABLE_OBSERVATION_REPORTS"), True
            ),
            observation_interval_seconds=int(
                os.getenv("OBSERVATION_INTERVAL_SECONDS", "300")
            ),
            observation_metric_name=os.getenv(
                "OBSERVATION_METRIC_NAME", "intent_latency_ms"
            ),
            graphdb_base_url=os.getenv(
                "GRAPHDB_BASE_URL", "http://start5g-1.cs.uit.no:7200"
            ),
            graphdb_repository=os.getenv("GRAPHDB_REPOSITORY", "intents_and_intent_reports"),
            enable_graphdb=_str_to_bool(os.getenv("ENABLE_GRAPHDB"), True),
            observation_reporting_enabled=_str_to_bool(
                os.getenv("OBSERVATION_REPORTING_ENABLED"), True
            ),
            observation_reporting_frequency=int(
                os.getenv("OBSERVATION_REPORTING_FREQUENCY", "30")
            ),
            prometheus_query_timeout=int(
                os.getenv("PROMETHEUS_QUERY_TIMEOUT", "10")
            ),
            prometheus_retry_attempts=int(
                os.getenv("PROMETHEUS_RETRY_ATTEMPTS", "3")
            ),
        )


