from __future__ import annotations

import logging
import subprocess
import tempfile
import os
import threading
import time
from typing import Optional
from urllib.parse import urlparse
import requests

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


class HelmDeployer:
    """Helm chart deployment helper for Intents."""

    def __init__(self, config: AppConfig):
        self._config = config
        self._logger = logging.getLogger(self.__class__.__name__)
        self._enabled = config.enable_k8s
        self._core_client: Optional["client.CoreV1Api"] = None
        self._source_namespace = config.kube_namespace or "inorch-tmf-proxy"
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
            # If the URL points to start5g-1.cs.uit.no:3040, rewrite it to use the Kubernetes service
            # This allows pods to access the chart server running on the host
            if parsed.hostname in ("start5g-1.cs.uit.no", "129.242.22.51") and parsed.port == 3040:
                # Rewrite to use the Kubernetes service
                service_url = f"{parsed.scheme}://chart-server.default.svc.cluster.local:3040{parsed.path}"
                if parsed.query:
                    service_url += f"?{parsed.query}"
                self._logger.info(
                    "Rewriting chart URL from %s to %s (using Kubernetes service)", chart_url, service_url
                )
                chart_url = service_url
            
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

            # Install without --wait first, so we can patch ServiceAccounts before pods try to pull images
            result = subprocess.run(
                [
                    "helm",
                    "install",
                    release_name,
                    chart_path,
                    "--namespace",
                    namespace,
                    "--timeout",
                    "5m",
                ],
                capture_output=True,
                text=True,
                timeout=600,
            )

            if result.returncode != 0:
                self._logger.error(
                    "Failed to install Helm release %s: %s",
                    release_name,
                    result.stderr,
                )
                return False

            self._logger.info(
                "Helm chart installed, waiting for resources to be created before patching ServiceAccounts..."
            )
            
            # Wait a moment for resources to be created
            time.sleep(3)
            
            # Patch ServiceAccounts immediately so pods can pull images
            self._logger.info("Patching ServiceAccounts with imagePullSecrets...")
            self._patch_service_accounts_with_image_pull_secret(namespace)
            
            # Delete any pods that were created before the ServiceAccount patch
            # so they get recreated with the correct imagePullSecrets
            self._logger.info("Deleting existing pods to recreate them with updated ServiceAccount...")
            self._delete_pods_for_recreation(namespace)
            
            # Now wait for deployments to be ready using kubectl rollout status
            self._logger.info("Waiting for Helm release deployments to be ready...")
            self._wait_for_helm_release_ready(release_name, namespace)
            
            self._logger.info(
                "Successfully installed Helm release %s in namespace %s for intent_id=%s",
                release_name,
                namespace,
                intent_id,
            )
            # Create Ingress resources for NodePort services
            self._create_ingress_for_nodeport_services(namespace)
            # Check for NodePort services and log access information
            self._log_service_access_info(namespace, release_name, intent_id)
            return True

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

            # Upgrade without --wait first, so we can patch ServiceAccounts before pods try to pull images
            result = subprocess.run(
                [
                    "helm",
                    "upgrade",
                    release_name,
                    chart_path,
                    "--namespace",
                    namespace,
                    "--timeout",
                    "5m",
                ],
                capture_output=True,
                text=True,
                timeout=600,
            )

            if result.returncode != 0:
                self._logger.error(
                    "Failed to upgrade Helm release %s: %s",
                    release_name,
                    result.stderr,
                )
                return False

            self._logger.info(
                "Helm chart upgraded, waiting for resources to be updated before patching ServiceAccounts..."
            )
            
            # Wait a moment for resources to be updated
            time.sleep(3)
            
            # Patch ServiceAccounts immediately so pods can pull images
            self._logger.info("Patching ServiceAccounts with imagePullSecrets...")
            self._patch_service_accounts_with_image_pull_secret(namespace)
            
            # Delete any pods that were created before the ServiceAccount patch
            # so they get recreated with the correct imagePullSecrets
            self._logger.info("Deleting existing pods to recreate them with updated ServiceAccount...")
            self._delete_pods_for_recreation(namespace)
            
            # Now wait for deployments to be ready using kubectl rollout status
            self._logger.info("Waiting for Helm release deployments to be ready...")
            self._wait_for_helm_release_ready(release_name, namespace)
            
            self._logger.info(
                "Successfully upgraded Helm release %s in namespace %s for intent_id=%s",
                release_name,
                namespace,
                intent_id,
            )
            # Create Ingress resources for NodePort services
            self._create_ingress_for_nodeport_services(namespace)
            # Check for NodePort services and log access information
            self._log_service_access_info(namespace, release_name, intent_id)
            return True

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

    def _wait_for_helm_release_ready(self, release_name: str, namespace: str) -> None:
        """Wait for Helm release deployments to be ready using kubectl rollout status."""
        try:
            # Try to get all deployments managed by this Helm release
            # Helm adds labels like app.kubernetes.io/instance=release_name
            if self._core_client is None:
                # Fall back to kubectl
                try:
                    # Get deployments with the Helm release label
                    result = subprocess.run(
                        [
                            "kubectl",
                            "get",
                            "deployments",
                            "-n",
                            namespace,
                            "-l",
                            f"app.kubernetes.io/instance={release_name}",
                            "-o",
                            "jsonpath={.items[*].metadata.name}",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    
                    if result.returncode == 0 and result.stdout.strip():
                        deployments = result.stdout.strip().split()
                        for deployment_name in deployments:
                            self._logger.debug(
                                "Waiting for deployment %s to be ready...", deployment_name
                            )
                            rollout_result = subprocess.run(
                                [
                                    "kubectl",
                                    "rollout",
                                    "status",
                                    f"deployment/{deployment_name}",
                                    "-n",
                                    namespace,
                                    "--timeout",
                                    "5m",
                                ],
                                capture_output=True,
                                text=True,
                                timeout=300,
                            )
                            if rollout_result.returncode == 0:
                                self._logger.debug(
                                    "Deployment %s is ready", deployment_name
                                )
                            else:
                                self._logger.warning(
                                    "Deployment %s may not be fully ready: %s",
                                    deployment_name,
                                    rollout_result.stderr,
                                )
                    else:
                        # If no deployments found, just wait a bit for resources to settle
                        self._logger.debug(
                            "No deployments found for release %s, waiting for resources to settle...",
                            release_name,
                        )
                        time.sleep(5)
                except Exception as exc:
                    self._logger.warning(
                        "Failed to wait for deployments using kubectl: %s", exc
                    )
            else:
                # Use Kubernetes Python client
                try:
                    apps_v1 = client.AppsV1Api()
                    deployments = apps_v1.list_namespaced_deployment(
                        namespace=namespace,
                        label_selector=f"app.kubernetes.io/instance={release_name}",
                    )
                    
                    for deployment in deployments.items:
                        deployment_name = deployment.metadata.name
                        self._logger.debug(
                            "Waiting for deployment %s to be ready...", deployment_name
                        )
                        # Poll deployment status until ready
                        max_wait = 300  # 5 minutes
                        start_time = time.time()
                        while time.time() - start_time < max_wait:
                            try:
                                deployment = apps_v1.read_namespaced_deployment(
                                    name=deployment_name,
                                    namespace=namespace,
                                )
                                if (
                                    deployment.status.ready_replicas
                                    and deployment.status.ready_replicas
                                    >= deployment.spec.replicas
                                ):
                                    self._logger.debug(
                                        "Deployment %s is ready", deployment_name
                                    )
                                    break
                            except Exception:
                                pass  # Continue polling
                            time.sleep(2)  # Poll every 2 seconds
                        else:
                            self._logger.warning(
                                "Deployment %s did not become ready within timeout",
                                deployment_name,
                            )
                except Exception as exc:
                    self._logger.warning(
                        "Failed to wait for deployments using Kubernetes client: %s", exc
                    )
        except Exception as exc:
            self._logger.warning(
                "Error waiting for Helm release to be ready: %s", exc
            )

    def _patch_service_accounts_with_image_pull_secret(self, namespace: str) -> None:
        """Patch all ServiceAccounts in the namespace to include imagePullSecrets."""
        if self._core_client is None:
            # Fall back to kubectl
            try:
                # Get all ServiceAccounts in the namespace
                result = subprocess.run(
                    [
                        "kubectl",
                        "get",
                        "serviceaccount",
                        "-n",
                        namespace,
                        "-o",
                        "jsonpath={.items[*].metadata.name}",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                
                if result.returncode != 0 or not result.stdout.strip():
                    self._logger.debug(
                        "No ServiceAccounts found in namespace %s to patch", namespace
                    )
                    return
                
                service_accounts = result.stdout.strip().split()
                for sa_name in service_accounts:
                    # Patch the ServiceAccount to add imagePullSecrets
                    patch_result = subprocess.run(
                        [
                            "kubectl",
                            "patch",
                            "serviceaccount",
                            sa_name,
                            "-n",
                            namespace,
                            "--type",
                            "json",
                            "-p",
                            f'[{{"op": "add", "path": "/imagePullSecrets/-", "value": {{"name": "{self._image_pull_secret_name}"}}}}]',
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    
                    if patch_result.returncode == 0:
                        self._logger.info(
                            "Added imagePullSecret %s to ServiceAccount %s in namespace %s",
                            self._image_pull_secret_name,
                            sa_name,
                            namespace,
                        )
                    else:
                        # Check if the secret is already present (not an error)
                        if "already exists" in patch_result.stderr.lower():
                            self._logger.debug(
                                "ServiceAccount %s in namespace %s already has imagePullSecret %s",
                                sa_name,
                                namespace,
                                self._image_pull_secret_name,
                            )
                        else:
                            self._logger.warning(
                                "Failed to patch ServiceAccount %s in namespace %s: %s",
                                sa_name,
                                namespace,
                                patch_result.stderr,
                            )
            except Exception as exc:
                self._logger.warning(
                    "Failed to patch ServiceAccounts in namespace %s: %s",
                    namespace,
                    exc,
                )
            return
        
        # Use Kubernetes Python client
        try:
            service_accounts = self._core_client.list_namespaced_service_account(
                namespace=namespace
            )
            
            for sa in service_accounts.items:
                # Check if imagePullSecrets already contains our secret
                existing_secrets = [
                    ips.name
                    for ips in (sa.image_pull_secrets or [])
                    if ips.name == self._image_pull_secret_name
                ]
                
                if existing_secrets:
                    self._logger.debug(
                        "ServiceAccount %s in namespace %s already has imagePullSecret %s",
                        sa.metadata.name,
                        namespace,
                        self._image_pull_secret_name,
                    )
                    continue
                
                # Add the imagePullSecret
                if sa.image_pull_secrets is None:
                    sa.image_pull_secrets = []
                
                sa.image_pull_secrets.append(
                    client.V1LocalObjectReference(name=self._image_pull_secret_name)
                )
                
                try:
                    self._core_client.patch_namespaced_service_account(
                        name=sa.metadata.name,
                        namespace=namespace,
                        body=sa,
                    )
                    self._logger.info(
                        "Added imagePullSecret %s to ServiceAccount %s in namespace %s",
                        self._image_pull_secret_name,
                        sa.metadata.name,
                        namespace,
                    )
                except ApiException as exc:
                    self._logger.warning(
                        "Failed to patch ServiceAccount %s in namespace %s: %s",
                        sa.metadata.name,
                        namespace,
                        exc,
                    )
        except Exception as exc:
            self._logger.warning(
                "Failed to patch ServiceAccounts in namespace %s: %s",
                namespace,
                exc,
            )

    def _delete_pods_for_recreation(self, namespace: str) -> None:
        """Delete pods in the namespace so they get recreated with updated ServiceAccount imagePullSecrets."""
        try:
            if self._core_client is None:
                # Fall back to kubectl
                try:
                    # Get all pods in the namespace
                    result = subprocess.run(
                        [
                            "kubectl",
                            "get",
                            "pods",
                            "-n",
                            namespace,
                            "-o",
                            "jsonpath={.items[*].metadata.name}",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    
                    if result.returncode == 0 and result.stdout.strip():
                        pod_names = result.stdout.strip().split()
                        for pod_name in pod_names:
                            self._logger.debug(
                                "Deleting pod %s to recreate with updated ServiceAccount", pod_name
                            )
                            delete_result = subprocess.run(
                                [
                                    "kubectl",
                                    "delete",
                                    "pod",
                                    pod_name,
                                    "-n",
                                    namespace,
                                    "--ignore-not-found=true",
                                ],
                                capture_output=True,
                                text=True,
                                timeout=10,
                            )
                            if delete_result.returncode == 0:
                                self._logger.debug("Deleted pod %s", pod_name)
                            else:
                                self._logger.warning(
                                    "Failed to delete pod %s: %s", pod_name, delete_result.stderr
                                )
                    else:
                        self._logger.debug("No pods found in namespace %s to delete", namespace)
                except Exception as exc:
                    self._logger.warning(
                        "Failed to delete pods using kubectl in namespace %s: %s", namespace, exc
                    )
            else:
                # Use Kubernetes Python client
                try:
                    pods = self._core_client.list_namespaced_pod(namespace=namespace)
                    
                    for pod in pods.items:
                        pod_name = pod.metadata.name
                        self._logger.debug(
                            "Deleting pod %s to recreate with updated ServiceAccount", pod_name
                        )
                        try:
                            self._core_client.delete_namespaced_pod(
                                name=pod_name,
                                namespace=namespace,
                                grace_period_seconds=5,  # Short grace period for quick recreation
                            )
                            self._logger.debug("Deleted pod %s", pod_name)
                        except ApiException as exc:
                            if exc.status == 404:
                                self._logger.debug("Pod %s already deleted", pod_name)
                            else:
                                self._logger.warning(
                                    "Failed to delete pod %s: %s", pod_name, exc
                                )
                except Exception as exc:
                    self._logger.warning(
                        "Failed to delete pods using Kubernetes client in namespace %s: %s",
                        namespace,
                        exc,
                    )
        except Exception as exc:
            self._logger.warning(
                "Error deleting pods for recreation in namespace %s: %s", namespace, exc
            )

    def _create_ingress_for_nodeport_services(self, namespace: str) -> None:
        """Create Ingress resources for NodePort services to enable path-based routing."""
        if client is None:
            # Fall back to kubectl
            try:
                # Get all services in the namespace
                result = subprocess.run(
                    [
                        "kubectl",
                        "get",
                        "service",
                        "-n",
                        namespace,
                        "-o",
                        "jsonpath={.items[?(@.spec.type==\"NodePort\")].metadata.name}",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                
                if result.returncode != 0 or not result.stdout.strip():
                    self._logger.debug(
                        "No NodePort services found in namespace %s to create Ingress for",
                        namespace,
                    )
                    return
                
                service_names = result.stdout.strip().split()
                for svc_name in service_names:
                    # Get service port
                    port_result = subprocess.run(
                        [
                            "kubectl",
                            "get",
                            "service",
                            svc_name,
                            "-n",
                            namespace,
                            "-o",
                            "jsonpath={.spec.ports[0].port}",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    
                    if port_result.returncode != 0:
                        self._logger.warning(
                            "Could not determine port for service %s in namespace %s",
                            svc_name,
                            namespace,
                        )
                        continue
                    
                    service_port = port_result.stdout.strip() or "80"
                    
                    # Check if Ingress already exists
                    check_result = subprocess.run(
                        [
                            "kubectl",
                            "get",
                            "ingress",
                            svc_name,
                            "-n",
                            namespace,
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    
                    if check_result.returncode == 0:
                        self._logger.debug(
                            "Ingress %s already exists in namespace %s",
                            svc_name,
                            namespace,
                        )
                        continue
                    
                    # Create Ingress resource using kubectl
                    ingress_yaml = f"""apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {svc_name}
  namespace: {namespace}
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /{svc_name}
        pathType: Prefix
        backend:
          service:
            name: {svc_name}
            port:
              number: {int(service_port)}
"""
                    
                    apply_result = subprocess.run(
                        [
                            "kubectl",
                            "apply",
                            "-f",
                            "-",
                        ],
                        input=ingress_yaml,
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    
                    if apply_result.returncode == 0:
                        self._logger.info(
                            "Created Ingress %s for NodePort service %s in namespace %s (path: /%s/)",
                            svc_name,
                            svc_name,
                            namespace,
                            svc_name,
                        )
                    else:
                        self._logger.warning(
                            "Failed to create Ingress for service %s in namespace %s: %s",
                            svc_name,
                            namespace,
                            apply_result.stderr,
                        )
            except Exception as exc:
                self._logger.warning(
                    "Failed to create Ingress resources in namespace %s: %s",
                    namespace,
                    exc,
                )
            return
        
        # Use Kubernetes Python client
        try:
            v1 = client.CoreV1Api()
            networking_v1 = client.NetworkingV1Api()
            
            # Get all services in the namespace
            services = v1.list_namespaced_service(namespace=namespace)
            
            for svc in services.items:
                if svc.spec.type != "NodePort":
                    continue
                
                svc_name = svc.metadata.name
                
                # Check if Ingress already exists
                try:
                    networking_v1.read_namespaced_ingress(
                        name=svc_name,
                        namespace=namespace,
                    )
                    self._logger.debug(
                        "Ingress %s already exists in namespace %s",
                        svc_name,
                        namespace,
                    )
                    continue
                except ApiException as exc:
                    if exc.status != 404:
                        raise
                
                # Get the service port (use first port if multiple)
                service_port = 80
                if svc.spec.ports and len(svc.spec.ports) > 0:
                    service_port = svc.spec.ports[0].port
                
                # Create Ingress resource
                ingress = client.V1Ingress(
                    metadata=client.V1ObjectMeta(
                        name=svc_name,
                        namespace=namespace,
                        annotations={
                            "nginx.ingress.kubernetes.io/rewrite-target": "/",
                        },
                    ),
                    spec=client.V1IngressSpec(
                        ingress_class_name="nginx",
                        rules=[
                            client.V1IngressRule(
                                http=client.V1HTTPIngressRuleValue(
                                    paths=[
                                        client.V1HTTPIngressPath(
                                            path=f"/{svc_name}",
                                            path_type="Prefix",
                                            backend=client.V1IngressBackend(
                                                service=client.V1IngressServiceBackend(
                                                    name=svc_name,
                                                    port=client.V1ServiceBackendPort(
                                                        number=service_port
                                                    ),
                                                )
                                            ),
                                        )
                                    ]
                                )
                            )
                        ],
                    ),
                )
                
                try:
                    networking_v1.create_namespaced_ingress(
                        namespace=namespace,
                        body=ingress,
                    )
                    self._logger.info(
                        "Created Ingress %s for NodePort service %s in namespace %s (path: /%s/)",
                        svc_name,
                        svc_name,
                        namespace,
                        svc_name,
                    )
                except ApiException as exc:
                    if exc.status == 409:  # Already exists
                        self._logger.debug(
                            "Ingress %s already exists in namespace %s",
                            svc_name,
                            namespace,
                        )
                    else:
                        self._logger.warning(
                            "Failed to create Ingress for service %s in namespace %s: %s",
                            svc_name,
                            namespace,
                            exc,
                        )
        except Exception as exc:
            self._logger.warning(
                "Failed to create Ingress resources in namespace %s: %s",
                namespace,
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
                        "  Service: %s - NodePort: %s - Access via: http://%s:%s/",
                        svc_info["name"],
                        svc_info["node_port"],
                        minikube_ip,
                        svc_info["node_port"],
                    )
                    # Start port-forward in background to expose service externally
                    self._start_port_forward(
                        namespace, svc_info["name"], svc_info["node_port"], svc_info["port"]
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

    def _start_port_forward(
        self, namespace: str, service_name: str, local_port: int, target_port: int
    ) -> None:
        """Start kubectl port-forward in a background thread to expose service externally."""

        def run_port_forward():
            try:
                # Check if kubectl is available
                try:
                    subprocess.run(
                        ["kubectl", "version", "--client"],
                        capture_output=True,
                        text=True,
                        timeout=5,
                    )
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    self._logger.warning(
                        "kubectl not available, skipping port-forward for service %s/%s",
                        namespace,
                        service_name,
                    )
                    return
                
                self._logger.info(
                    "Starting port-forward for service %s/%s: %s -> %s",
                    namespace,
                    service_name,
                    local_port,
                    target_port,
                )
                # Run port-forward with --address 0.0.0.0 to allow external access
                result = subprocess.run(
                    [
                        "kubectl",
                        "port-forward",
                        "-n",
                        namespace,
                        f"svc/{service_name}",
                        f"{local_port}:{target_port}",
                        "--address",
                        "0.0.0.0",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=None,  # Run indefinitely
                )
                # If port-forward exits, log it
                if result.returncode != 0:
                    self._logger.warning(
                        "Port-forward for %s/%s exited with code %d: %s",
                        namespace,
                        service_name,
                        result.returncode,
                        result.stderr,
                    )
            except Exception as exc:
                self._logger.error(
                    "Error running port-forward for %s/%s: %s",
                    namespace,
                    service_name,
                    exc,
                    exc_info=True,
                )

        # Start port-forward in a daemon thread (will be killed when main process exits)
        thread = threading.Thread(target=run_port_forward, daemon=True)
        thread.start()
        self._logger.debug(
            "Started background thread for port-forward of %s/%s", namespace, service_name
        )
