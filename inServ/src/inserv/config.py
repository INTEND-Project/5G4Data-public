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
    port: int = 3010
    log_level: str = "INFO"
    kube_namespace: str = "default"
    workload_image: str = "busybox:stable"
    workload_pull_policy: str = "IfNotPresent"
    workload_service_account: str = "default"
    enable_k8s: bool = True

    @classmethod
    def from_env(cls) -> "AppConfig":
        """Create an AppConfig populated from environment variables."""
        return cls(
            host=os.getenv("INSERV_HOST", "0.0.0.0"),
            port=int(os.getenv("INSERV_PORT", "3010")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            kube_namespace=os.getenv("KUBE_NAMESPACE", "default"),
            workload_image=os.getenv("WORKLOAD_IMAGE", "busybox:stable"),
            workload_pull_policy=os.getenv("WORKLOAD_PULL_POLICY", "IfNotPresent"),
            workload_service_account=os.getenv(
                "WORKLOAD_SERVICE_ACCOUNT", "default"
            ),
            enable_k8s=_str_to_bool(os.getenv("ENABLE_K8S"), True),
        )


