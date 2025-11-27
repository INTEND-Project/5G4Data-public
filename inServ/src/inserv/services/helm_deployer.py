from __future__ import annotations

import logging
import subprocess
import tempfile
import os
from typing import Optional
from urllib.parse import urlparse
import requests

try:
    from kubernetes import client, config as kube_config
    from kubernetes.client import ApiException, NetworkingV1Api
    from kubernetes.client.models import (
        V1Ingress,
        V1IngressSpec,
        V1IngressRule,
        V1HTTPIngressRuleValue,
        V1HTTPIngressPath,
        V1IngressBackend,
        V1IngressServiceBackend,
        V1ServiceBackendPort,
        V1ObjectMeta,
    )
    from kubernetes.config.config_exception import ConfigException
except Exception:  # pragma: no cover - optional dependency for local dev
    client = None  # type: ignore
    kube_config = None  # type: ignore
    ApiException = Exception  # type: ignore
    ConfigException = Exception  # type: ignore
    NetworkingV1Api = None  # type: ignore
    V1Ingress = None  # type: ignore
    V1IngressSpec = None  # type: ignore
    V1IngressRule = None  # type: ignore
    V1HTTPIngressRuleValue = None  # type: ignore
    V1HTTPIngressPath = None  # type: ignore
    V1IngressBackend = None  # type: ignore
    V1IngressServiceBackend = None  # type: ignore
    V1ServiceBackendPort = None  # type: ignore
    V1ObjectMeta = None  # type: ignore

from inserv.config import AppConfig


class HelmDeployer:
    """Helm chart deployment helper for Intents."""

    def __init__(self, config: AppConfig):
        self._config = config
        self._logger = logging.getLogger(self.__class__.__name__)
        self._enabled = config.enable_k8s
        self._core_client: Optional["client.CoreV1Api"] = None
        self._source_namespace = config.kube_namespace or "inserv"
        self._image_pull_secret_name = "ghcr-creds"

        if not self._enabled:
            self._logger.warning("Helm deployment disabled (ENABLE_K8S set to false)")
            return

        # Initialize Kubernetes client for namespace operations
        if client is not None:
            try:
                try:
                    kube_config.load_incluster_config()
                except ConfigException:
                    try:
                        kube_config.load_kube_config()
                    except ConfigException as exc:
                        self._logger.warning("Failed to load Kubernetes config: %s", exc)
                else:
                    self._core_client = client.CoreV1Api()
            except Exception as exc:
                self._logger.warning("Failed to initialize Kubernetes client: %s", exc)

        # Verify Helm is available
        try:
            result = subprocess.run(
                ["helm", "version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                self._logger.error("Helm binary not working: %s", result.stderr)
                self._enabled = False
            else:
                self._logger.info("Helm deployment enabled")
        except FileNotFoundError:
            self._logger.error("Helm binary not found in PATH")
            self._enabled = False
        except Exception as exc:
            self._logger.error("Failed to verify Helm installation: %s", exc)
            self._enabled = False

    def deploy_chart(
        self,
        chart_url: str,
        namespace: str,
        release_name: Optional[str] = None,
        intent_id: Optional[str] = None,
    ) -> bool:
        """
        Deploy a Helm chart from a URL.

        Args:
            chart_url: URL to the Helm chart (.tgz file)
            namespace: Kubernetes namespace to deploy to
            release_name: Optional release name (defaults to namespace if not provided)
            intent_id: Optional intent ID for logging

        Returns:
            True if deployment succeeded, False otherwise
        """
        if not self._enabled:
            self._logger.warning("Helm deployment disabled, skipping chart deployment")
            return False

        if not release_name:
            release_name = namespace

        try:
            # Download chart if it's a URL
            chart_path = self._get_chart_path(chart_url)
            if not chart_path:
                self._logger.error("Failed to get chart path for URL: %s", chart_url)
                return False

            # Ensure namespace exists
            self._ensure_namespace(namespace)

            # Check if release already exists
            if self._release_exists(release_name, namespace):
                self._logger.info(
                    "Release %s already exists in namespace %s, upgrading...",
                    release_name,
                    namespace,
                )
                return self._upgrade_release(release_name, chart_path, namespace, intent_id)
            else:
                return self._install_release(
                    release_name, chart_path, namespace, intent_id
                )

        except Exception as exc:
            self._logger.error(
                "Failed to deploy Helm chart for intent_id=%s: %s",
                intent_id,
                exc,
                exc_info=True,
            )
            return False

    def delete_release(
        self, release_name: str, namespace: str, intent_id: Optional[str] = None
    ) -> bool:
        """
        Delete a Helm release.

        Args:
            release_name: Name of the Helm release
            namespace: Kubernetes namespace
            intent_id: Optional intent ID for logging

        Returns:
            True if deletion succeeded or release doesn't exist, False on error
        """
        if not self._enabled:
            return False

        try:
            if not self._release_exists(release_name, namespace):
                self._logger.debug(
                    "Release %s does not exist in namespace %s, skipping deletion",
                    release_name,
                    namespace,
                )
                return True

            result = subprocess.run(
                [
                    "helm",
                    "uninstall",
                    release_name,
                    "--namespace",
                    namespace,
                ],
                capture_output=True,
                text=True,
                timeout=300,
            )

            if result.returncode == 0:
                self._logger.info(
                    "Deleted Helm release %s in namespace %s for intent_id=%s",
                    release_name,
                    namespace,
                    intent_id,
                )
                return True
            else:
                self._logger.error(
                    "Failed to delete Helm release %s: %s",
                    release_name,
                    result.stderr,
                )
                return False

        except Exception as exc:
            self._logger.error(
                "Exception while deleting Helm release %s for intent_id=%s: %s",
                release_name,
                intent_id,
                exc,
                exc_info=True,
            )
            return False

    def _get_chart_path(self, chart_url: str) -> Optional[str]:
        """
        Get the path to the Helm chart.
        If it's a URL, download it to a temporary file.
        If it's a local path, return it as-is.
        """
        parsed = urlparse(chart_url)

        # If it's a URL (http/https), download it
        if parsed.scheme in ("http", "https"):
            try:
                self._logger.debug("Downloading Helm chart from %s", chart_url)
                response = requests.get(chart_url, timeout=300)
                response.raise_for_status()

                # Create temporary file
                with tempfile.NamedTemporaryFile(
                    mode="wb", suffix=".tgz", delete=False
                ) as tmp_file:
                    tmp_file.write(response.content)
                    chart_path = tmp_file.name

                self._logger.debug("Downloaded chart to %s", chart_path)
                return chart_path

            except Exception as exc:
                self._logger.error("Failed to download chart from %s: %s", chart_url, exc)
                return None

        # If it's a file path, check if it exists
        elif parsed.scheme == "" or parsed.scheme == "file":
            if os.path.exists(chart_url):
                return chart_url
            else:
                self._logger.error("Chart file not found: %s", chart_url)
                return None

        else:
            self._logger.error("Unsupported chart URL scheme: %s", parsed.scheme)
            return None

    def _ensure_namespace(self, namespace: str) -> None:
        """Ensure the Kubernetes namespace exists."""
        if self._core_client is None:
            # Fall back to kubectl if Kubernetes client is not available
            try:
                result = subprocess.run(
                    ["kubectl", "get", "namespace", namespace],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )

                if result.returncode != 0:
                    # Namespace doesn't exist, create it
                    self._logger.info("Creating namespace %s", namespace)
                    create_result = subprocess.run(
                        ["kubectl", "create", "namespace", namespace],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    if create_result.returncode != 0:
                        self._logger.warning(
                            "Failed to create namespace %s: %s",
                            namespace,
                            create_result.stderr,
                        )
                    else:
                        self._logger.info("Created namespace %s", namespace)
                        # Copy image pull secret to the new namespace
                        self._copy_image_pull_secret_kubectl(namespace)
            except Exception as exc:
                self._logger.warning(
                    "Failed to ensure namespace %s exists: %s", namespace, exc
                )
            return

        # Use Kubernetes Python client
        try:
            try:
                self._core_client.read_namespace(name=namespace)
                # Namespace exists
                self._logger.debug("Namespace %s already exists", namespace)
            except ApiException as exc:
                if exc.status == 404:
                    # Namespace doesn't exist, create it
                    self._logger.info("Creating namespace %s", namespace)
                    namespace_body = client.V1Namespace(
                        metadata=client.V1ObjectMeta(name=namespace)
                    )
                    try:
                        self._core_client.create_namespace(body=namespace_body)
                        self._logger.info("Created namespace %s", namespace)
                        # Copy image pull secret to the new namespace
                        self._copy_image_pull_secret(namespace)
                    except ApiException as create_exc:
                        self._logger.warning(
                            "Failed to create namespace %s: %s",
                            namespace,
                            create_exc,
                        )
                else:
                    self._logger.warning(
                        "Failed to check namespace %s: %s", namespace, exc
                    )
        except Exception as exc:
            self._logger.warning(
                "Failed to ensure namespace %s exists: %s", namespace, exc
            )

    def _release_exists(self, release_name: str, namespace: str) -> bool:
        """Check if a Helm release exists."""
        try:
            result = subprocess.run(
                [
                    "helm",
                    "list",
                    "--namespace",
                    namespace,
                    "--filter",
                    release_name,
                    "--short",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.returncode == 0 and release_name in result.stdout
        except Exception:
            return False

    def _install_release(
        self,
        release_name: str,
        chart_path: str,
        namespace: str,
        intent_id: Optional[str] = None,
    ) -> bool:
        """Install a new Helm release."""
        try:
            self._logger.info(
                "Installing Helm chart %s as release %s in namespace %s for intent_id=%s",
                chart_path,
                release_name,
                namespace,
                intent_id,
            )

            result = subprocess.run(
                [
                    "helm",
                    "install",
                    release_name,
                    chart_path,
                    "--namespace",
                    namespace,
                    "--wait",
                    "--timeout",
                    "5m",
                ],
                capture_output=True,
                text=True,
                timeout=600,
            )

            if result.returncode == 0:
                self._logger.info(
                    "Successfully installed Helm release %s in namespace %s for intent_id=%s",
                    release_name,
                    namespace,
                    intent_id,
                )
                # Check for NodePort services and log access information
                self._log_service_access_info(namespace, release_name, intent_id)
                return True
            else:
                self._logger.error(
                    "Failed to install Helm release %s: %s",
                    release_name,
                    result.stderr,
                )
                return False

        except subprocess.TimeoutExpired:
            self._logger.error(
                "Helm install timed out for release %s in namespace %s",
                release_name,
                namespace,
            )
            return False
        except Exception as exc:
            self._logger.error(
                "Exception during Helm install for release %s: %s",
                release_name,
                exc,
                exc_info=True,
            )
            return False
        finally:
            # Clean up temporary file if it was downloaded
            if chart_path.startswith(tempfile.gettempdir()):
                try:
                    os.unlink(chart_path)
                except Exception:
                    pass

    def _upgrade_release(
        self,
        release_name: str,
        chart_path: str,
        namespace: str,
        intent_id: Optional[str] = None,
    ) -> bool:
        """Upgrade an existing Helm release."""
        try:
            self._logger.info(
                "Upgrading Helm release %s in namespace %s for intent_id=%s",
                release_name,
                namespace,
                intent_id,
            )

            result = subprocess.run(
                [
                    "helm",
                    "upgrade",
                    release_name,
                    chart_path,
                    "--namespace",
                    namespace,
                    "--wait",
                    "--timeout",
                    "5m",
                ],
                capture_output=True,
                text=True,
                timeout=600,
            )

            if result.returncode == 0:
                self._logger.info(
                    "Successfully upgraded Helm release %s in namespace %s for intent_id=%s",
                    release_name,
                    namespace,
                    intent_id,
                )
                # Check for NodePort services and log access information
                self._log_service_access_info(namespace, release_name, intent_id)
                return True
            else:
                self._logger.error(
                    "Failed to upgrade Helm release %s: %s",
                    release_name,
                    result.stderr,
                )
                return False

        except subprocess.TimeoutExpired:
            self._logger.error(
                "Helm upgrade timed out for release %s in namespace %s",
                release_name,
                namespace,
            )
            return False
        except Exception as exc:
            self._logger.error(
                "Exception during Helm upgrade for release %s: %s",
                release_name,
                exc,
                exc_info=True,
            )
            return False
        finally:
            # Clean up temporary file if it was downloaded
            if chart_path.startswith(tempfile.gettempdir()):
                try:
                    os.unlink(chart_path)
                except Exception:
                    pass


    def _copy_image_pull_secret(self, target_namespace: str) -> None:
        """Copy the image pull secret from source namespace to target namespace."""
        if self._core_client is None:
            return

        try:
            # Get the secret from source namespace
            try:
                source_secret = self._core_client.read_namespaced_secret(
                    name=self._image_pull_secret_name,
                    namespace=self._source_namespace,
                )
            except ApiException as exc:
                if exc.status == 404:
                    self._logger.debug(
                        "Image pull secret %s not found in namespace %s, skipping copy",
                        self._image_pull_secret_name,
                        self._source_namespace,
                    )
                    return
                else:
                    raise

            # Check if secret already exists in target namespace
            try:
                self._core_client.read_namespaced_secret(
                    name=self._image_pull_secret_name,
                    namespace=target_namespace,
                )
                self._logger.debug(
                    "Image pull secret %s already exists in namespace %s",
                    self._image_pull_secret_name,
                    target_namespace,
                )
                return
            except ApiException as exc:
                if exc.status != 404:
                    raise

            # Create the secret in target namespace
            target_secret = client.V1Secret(
                metadata=client.V1ObjectMeta(
                    name=self._image_pull_secret_name,
                    namespace=target_namespace,
                ),
                type=source_secret.type,
                data=source_secret.data,
            )

            self._core_client.create_namespaced_secret(
                namespace=target_namespace, body=target_secret
            )
            self._logger.info(
                "Copied image pull secret %s from namespace %s to namespace %s",
                self._image_pull_secret_name,
                self._source_namespace,
                target_namespace,
            )

        except Exception as exc:
                self._logger.warning(
                    "Failed to copy image pull secret to namespace %s: %s",
                    target_namespace,
                    exc,
                )

    def _copy_image_pull_secret_kubectl(self, target_namespace: str) -> None:
        """Copy the image pull secret using kubectl (fallback method)."""
        try:
            # Check if secret exists in source namespace
            check_result = subprocess.run(
                [
                    "kubectl",
                    "get",
                    "secret",
                    self._image_pull_secret_name,
                    "-n",
                    self._source_namespace,
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if check_result.returncode != 0:
                self._logger.debug(
                    "Image pull secret %s not found in namespace %s, skipping copy",
                    self._image_pull_secret_name,
                    self._source_namespace,
                )
                return

            # Check if secret already exists in target namespace
            check_target = subprocess.run(
                [
                    "kubectl",
                    "get",
                    "secret",
                    self._image_pull_secret_name,
                    "-n",
                    target_namespace,
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if check_target.returncode == 0:
                self._logger.debug(
                    "Image pull secret %s already exists in namespace %s",
                    self._image_pull_secret_name,
                    target_namespace,
                )
                return

            # Copy the secret using kubectl
            copy_result = subprocess.run(
                [
                    "kubectl",
                    "get",
                    "secret",
                    self._image_pull_secret_name,
                    "-n",
                    self._source_namespace,
                    "-o",
                    "json",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if copy_result.returncode != 0:
                self._logger.warning(
                    "Failed to get secret %s from namespace %s",
                    self._image_pull_secret_name,
                    self._source_namespace,
                )
                return

            # Use kubectl to create the secret in target namespace
            import json

            secret_data = json.loads(copy_result.stdout)
            # Remove namespace and metadata fields
            secret_data["metadata"].pop("namespace", None)
            secret_data["metadata"].pop("uid", None)
            secret_data["metadata"].pop("resourceVersion", None)
            secret_data["metadata"].pop("creationTimestamp", None)

            # Apply to target namespace
            apply_result = subprocess.run(
                [
                    "kubectl",
                    "apply",
                    "-f",
                    "-",
                    "-n",
                    target_namespace,
                ],
                input=json.dumps(secret_data),
                capture_output=True,
                text=True,
                timeout=10,
            )

            if apply_result.returncode == 0:
                self._logger.info(
                    "Copied image pull secret %s from namespace %s to namespace %s",
                    self._image_pull_secret_name,
                    self._source_namespace,
                    target_namespace,
                )
            else:
                self._logger.warning(
                    "Failed to copy secret to namespace %s: %s",
                    target_namespace,
                    apply_result.stderr,
                )

        except Exception as exc:
                self._logger.warning(
                    "Failed to copy image pull secret to namespace %s: %s",
                    target_namespace,
                    exc,
                )

    def _log_service_access_info(
        self, namespace: str, release_name: str, intent_id: Optional[str] = None
    ) -> None:
        """Log access information for NodePort services after deployment."""
        if client is None:
            return

        try:
            # Get all services in the namespace
            v1 = client.CoreV1Api()
            services = v1.list_namespaced_service(namespace=namespace)

            nodeport_services = []
            for svc in services.items:
                if svc.spec.type == "NodePort":
                    for port in svc.spec.ports:
                        if port.node_port:
                            nodeport_services.append(
                                {
                                    "name": svc.metadata.name,
                                    "node_port": port.node_port,
                                    "port": port.port,
                                    "target_port": port.target_port,
                                }
                            )

            if nodeport_services:
                self._logger.info(
                    "NodePort services detected for release %s in namespace %s (intent_id=%s):",
                    release_name,
                    namespace,
                    intent_id,
                )
                for svc_info in nodeport_services:
                    # Try to get minikube IP
                    minikube_ip = "192.168.49.2"  # Default minikube IP
                    try:
                        result = subprocess.run(
                            ["minikube", "ip", "-p", "inOrch"],
                            capture_output=True,
                            text=True,
                            timeout=5,
                        )
                        if result.returncode == 0:
                            minikube_ip = result.stdout.strip()
                    except Exception:
                        pass  # Use default

                    self._logger.info(
                        "  Service: %s - NodePort: %s",
                        svc_info["name"],
                        svc_info["node_port"],
                    )
                    # Create Ingress resource for path-based routing
                    self._create_ingress_for_service(
                        namespace, svc_info, namespace, intent_id
                    )
            else:
                self._logger.debug(
                    "No NodePort services found for release %s in namespace %s",
                    release_name,
                    namespace,
                )

        except Exception as exc:
            self._logger.debug(
                "Could not retrieve service access info for namespace %s: %s",
                namespace,
                exc,
            )

    def _create_ingress_for_service(
        self,
        namespace: str,
        service_info: dict,
        application_name: str,
        intent_id: Optional[str] = None,
    ) -> bool:
        """Create an Ingress resource for a service using path-based routing."""
        if client is None or NetworkingV1Api is None:
            self._logger.warning(
                "Kubernetes client not available, cannot create Ingress for service %s/%s",
                namespace,
                service_info["name"],
            )
            return False

        try:
            networking = NetworkingV1Api()

            # Use path-based routing: /<application-name>/
            path = f"/{application_name}/"

            # Get ingress controller's NodePort for access info
            ingress_nodeport = self._get_ingress_nodeport()
            ingress_host = os.getenv("INGRESS_HOST", "start5g-1.cs.uit.no")

            # Create Ingress resource
            ingress = V1Ingress(
                metadata=V1ObjectMeta(
                    name=f"{service_info['name']}-ingress",
                    namespace=namespace,
                    labels={
                        "managed-by": "inserv",
                        "intent-id": intent_id or "unknown",
                        "application": application_name,
                    },
                    annotations={
                        "nginx.ingress.kubernetes.io/rewrite-target": "/",
                        "nginx.ingress.kubernetes.io/use-regex": "false",
                    },
                ),
                spec=V1IngressSpec(
                    ingress_class_name="nginx",
                    rules=[
                        V1IngressRule(
                            http=V1HTTPIngressRuleValue(
                                paths=[
                                    V1HTTPIngressPath(
                                        path=path,
                                        path_type="Prefix",
                                        backend=V1IngressBackend(
                                            service=V1IngressServiceBackend(
                                                name=service_info["name"],
                                                port=V1ServiceBackendPort(
                                                    number=service_info["port"],
                                                ),
                                            ),
                                        ),
                                    ),
                                ],
                            ),
                        ),
                    ],
                ),
            )

            try:
                networking.create_namespaced_ingress(namespace=namespace, body=ingress)
                self._logger.info(
                    "Created Ingress for service %s/%s: http://%s:%s%s",
                    namespace,
                    service_info["name"],
                    ingress_host,
                    ingress_nodeport,
                    path,
                )
                return True
            except ApiException as exc:
                if exc.status == 409:  # Already exists
                    # Try to update it
                    try:
                        existing = networking.read_namespaced_ingress(
                            name=f"{service_info['name']}-ingress", namespace=namespace
                        )
                        # Update metadata
                        ingress.metadata.resource_version = existing.metadata.resource_version
                        networking.replace_namespaced_ingress(
                            name=f"{service_info['name']}-ingress",
                            namespace=namespace,
                            body=ingress,
                        )
                        self._logger.info(
                            "Updated Ingress for service %s/%s: http://%s:%s%s",
                            namespace,
                            service_info["name"],
                            ingress_host,
                            ingress_nodeport,
                            path,
                        )
                        return True
                    except Exception as update_exc:
                        self._logger.warning(
                            "Failed to update existing Ingress: %s", update_exc
                        )
                        return False
                else:
                    raise

        except ApiException as exc:
            self._logger.warning(
                "Failed to create Ingress for service %s/%s: %s (status: %d)",
                namespace,
                service_info["name"],
                exc.reason,
                exc.status,
            )
            return False
        except Exception as exc:
            self._logger.error(
                "Exception creating Ingress for service %s/%s: %s",
                namespace,
                service_info["name"],
                exc,
                exc_info=True,
            )
            return False

    def _get_ingress_nodeport(self) -> int:
        """Get the NodePort of the ingress controller service."""
        if client is None:
            return 30080  # Default

        try:
            v1 = client.CoreV1Api()
            # Try to find ingress-nginx controller service
            # Check common namespaces for ingress controllers
            namespaces_to_check = ["ingress-nginx", "kube-system", "default"]
            for ns in namespaces_to_check:
                try:
                    services = v1.list_namespaced_service(namespace=ns)
                    for svc in services.items:
                        # Look for ingress controller services
                        if (
                            "ingress" in svc.metadata.name.lower()
                            and svc.spec.type == "NodePort"
                        ):
                            for port in svc.spec.ports:
                                if port.node_port and port.name in ["http", "http-port"]:
                                    self._logger.debug(
                                        "Found ingress controller NodePort: %d (service: %s/%s)",
                                        port.node_port,
                                        ns,
                                        svc.metadata.name,
                                    )
                                    return port.node_port
                except ApiException:
                    continue  # Namespace might not exist

            # Fallback: check all namespaces
            try:
                services = v1.list_service_for_all_namespaces()
                for svc in services.items:
                    if (
                        "ingress" in svc.metadata.name.lower()
                        and "controller" in svc.metadata.name.lower()
                        and svc.spec.type == "NodePort"
                    ):
                        for port in svc.spec.ports:
                            if port.node_port and port.name in ["http", "http-port"]:
                                self._logger.debug(
                                    "Found ingress controller NodePort: %d (service: %s/%s)",
                                    port.node_port,
                                    svc.metadata.namespace,
                                    svc.metadata.name,
                                )
                                return port.node_port
            except Exception:
                pass

        except Exception as exc:
            self._logger.debug("Could not determine ingress NodePort: %s", exc)

        # Default fallback
        self._logger.debug("Using default ingress NodePort: 30080")
        return 30080
