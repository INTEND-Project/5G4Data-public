from __future__ import annotations

import logging
from typing import Optional

try:
    from kubernetes import client, config as kube_config
    from kubernetes.client import ApiException
    from kubernetes.config.config_exception import ConfigException
except Exception:  # pragma: no cover - optional dependency for local dev
    client = None  # type: ignore
    kube_config = None  # type: ignore
    ApiException = Exception  # type: ignore
    ConfigException = Exception  # type: ignore

from inorch_tmf_proxy.config import AppConfig
from inorch_tmf_proxy.models.intent import Intent


class KubernetesDeployer:
    """Best-effort workload deployment helper for Intents."""

    def __init__(self, config: AppConfig):
        self._config = config
        self._logger = logging.getLogger(self.__class__.__name__)
        self._enabled = config.enable_k8s and client is not None
        self._apps_client: Optional["client.AppsV1Api"] = None

        if not self._enabled:
            self._logger.warning(
                "Kubernetes integration disabled (client missing or ENABLE_K8S set to false)"
            )
            return

        try:
            kube_config.load_incluster_config()
        except ConfigException:
            try:
                kube_config.load_kube_config()
            except ConfigException as exc:
                self._logger.error("Failed to load Kubernetes config: %s", exc)
                self._enabled = False
                return

        self._apps_client = client.AppsV1Api()
        self._logger.info(
            "Kubernetes integration enabled for namespace=%s", config.kube_namespace
        )

    def deploy_for_intent(self, intent: Intent) -> None:
        if not self._enabled or not self._apps_client:
            return

        deployment = self._build_deployment(intent)
        try:
            self._apps_client.create_namespaced_deployment(
                namespace=self._config.kube_namespace, body=deployment
            )
            self._logger.info(
                "Submitted deployment for intent_id=%s", intent.id
            )
        except ApiException as exc:
            if exc.status == 409:
                self._apps_client.patch_namespaced_deployment(
                    name=deployment.metadata.name,
                    namespace=self._config.kube_namespace,
                    body=deployment,
                )
                self._logger.info(
                    "Patched existing deployment for intent_id=%s", intent.id
                )
            else:
                self._logger.error(
                    "Failed to deploy workload for intent_id=%s: %s",
                    intent.id,
                    exc,
                )

    def delete_for_intent(self, intent_id: str) -> None:
        if not self._enabled or not self._apps_client:
            return

        name = self._deployment_name(intent_id)
        try:
            self._apps_client.delete_namespaced_deployment(
                name=name, namespace=self._config.kube_namespace
            )
            self._logger.info("Deleted deployment for intent_id=%s", intent_id)
        except ApiException as exc:
            if exc.status != 404:
                self._logger.error(
                    "Failed to delete deployment for intent_id=%s: %s",
                    intent_id,
                    exc,
                )

    def _build_deployment(self, intent: Intent) -> "client.V1Deployment":
        labels = {
            "app.kubernetes.io/name": "inorch-tmf-proxy-intent-workload",
            "app.kubernetes.io/intent-id": intent.id,
        }
        container = client.V1Container(
            name="intent-workload",
            image=self._config.workload_image,
            image_pull_policy=self._config.workload_pull_policy,
            env=[
                client.V1EnvVar(name="INTENT_ID", value=intent.id),
                client.V1EnvVar(name="INTENT_NAME", value=intent.name or intent.id),
            ],
        )
        template = client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(labels=labels),
            spec=client.V1PodSpec(
                containers=[container],
                service_account_name=self._config.workload_service_account,
            ),
        )
        spec = client.V1DeploymentSpec(
            replicas=1,
            selector=client.V1LabelSelector(match_labels=labels),
            template=template,
        )
        return client.V1Deployment(
            metadata=client.V1ObjectMeta(name=self._deployment_name(intent.id)),
            spec=spec,
        )

    @staticmethod
    def _deployment_name(intent_id: str) -> str:
        normalized = intent_id.lower().replace("_", "-")
        return f"intent-{normalized}"[:63]


