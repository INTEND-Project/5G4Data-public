from __future__ import annotations

import logging
import subprocess
import tempfile
import os
import threading
import time
import re
import json
from typing import Optional
from urllib.parse import urlparse
import requests

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

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
        self._image_pull_secret_name = "ghcr-secret"

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
        p99_token_target: Optional[float] = None,
    ) -> bool:
        """
        Deploy a Helm chart from a URL.

        Args:
            chart_url: URL to the Helm chart (.tgz file)
            namespace: Kubernetes namespace to deploy to
            release_name: Optional release name (defaults to namespace if not provided)
            intent_id: Optional intent ID for logging
            p99_token_target: Optional p99-token-target value in seconds (for IDO Intent creation)

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
            
            # Ensure secret exists as a safety net (in case _ensure_namespace had issues)
            # This is idempotent - won't fail if secret already exists
            try:
                if self._core_client is not None:
                    self._copy_image_pull_secret(namespace)
                else:
                    self._copy_image_pull_secret_kubectl(namespace)
            except Exception as exc:
                self._logger.warning(
                    "Failed to ensure secret exists in namespace %s: %s", namespace, exc
                )

            # Check if release already exists
            if self._release_exists(release_name, namespace):
                self._logger.info(
                    "Release %s already exists in namespace %s, upgrading...",
                    release_name,
                    namespace,
                )
                success = self._upgrade_release(release_name, chart_path, namespace, intent_id, p99_token_target)
            else:
                success = self._install_release(
                    release_name, chart_path, namespace, intent_id, p99_token_target
                )
            
            # Create IDO Intent and KPIProfile if p99_token_target is provided and deployment succeeded
            if success and p99_token_target is not None:
                self._create_ido_intent_and_kpi_profile(
                    namespace=namespace,
                    intent_id=intent_id,
                    p99_token_target=p99_token_target,
                )
            
            return success

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
                else:
                    # Namespace exists - ensure secret exists too
                    self._logger.debug("Namespace %s already exists", namespace)
                    # Copy image pull secret to the namespace (even if it already existed)
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
                # Namespace exists - ensure secret exists too
                self._logger.debug("Namespace %s already exists", namespace)
                # Copy image pull secret to the namespace (even if it already existed)
                self._copy_image_pull_secret(namespace)
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

    def _is_nodeport_in_use(self, nodeport: int) -> bool:
        """
        Check if a NodePort is already in use across all minikube clusters.
        
        Args:
            nodeport: The NodePort to check (must be in range 30000-32767)
            
        Returns:
            True if the port is in use, False if available
        """
        if nodeport < 30000 or nodeport > 32767:
            self._logger.warning("NodePort %d is outside valid range (30000-32767)", nodeport)
            return True  # Consider invalid ports as "in use"
        
        # Get all minikube profiles
        try:
            result = subprocess.run(
                ["minikube", "profile", "list"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            
            if result.returncode != 0:
                self._logger.debug("Could not list minikube profiles, assuming port is available")
                return False
            
            # Parse profiles from output
            # minikube profile list output format:
            # |----------|-----------|---------|----------------|------|
            # | Profile  | VM Driver | Runtime |      IP        | Port |
            # |----------|-----------|---------|----------------|------|
            # | profile1 | docker    | docker  | 192.168.49.2   | 8443 |
            profiles = []
            lines = result.stdout.split('\n')
            # Find header line (contains "Profile")
            header_idx = -1
            for i, line in enumerate(lines):
                if "Profile" in line and "VM Driver" in line:
                    header_idx = i
                    break
            
            # Parse profile names from lines after header
            if header_idx >= 0:
                for line in lines[header_idx + 1:]:
                    line = line.strip()
                    if not line or line.startswith('|') and '---' in line:
                        continue
                    # Extract profile name (first column after |)
                    parts = [p.strip() for p in line.split('|') if p.strip()]
                    if parts:
                        profile_name = parts[0]
                        # Skip header-like lines and empty names
                        if profile_name and profile_name not in ("Profile", "minikube") and not profile_name.startswith('-'):
                            profiles.append(profile_name)
            
            # Also check current context if available (in case it's not in profile list)
            try:
                result = subprocess.run(
                    ["kubectl", "config", "current-context"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    current_context = result.stdout.strip()
                    if current_context and current_context not in profiles:
                        profiles.append(current_context)
            except Exception:
                pass
            
            # If no profiles found, try to check current context directly
            if not profiles:
                self._logger.debug("No minikube profiles found, checking current context only")
                try:
                    # Check current context without specifying --context
                    result = subprocess.run(
                        [
                            "kubectl",
                            "get",
                            "svc",
                            "--all-namespaces",
                            "-o",
                            "json",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    if result.returncode == 0:
                        services_data = json.loads(result.stdout)
                        for item in services_data.get("items", []):
                            if item.get("spec", {}).get("type") == "NodePort":
                                ports = item.get("spec", {}).get("ports", [])
                                for port in ports:
                                    if port.get("nodePort") == nodeport:
                                        self._logger.debug(
                                            "NodePort %d is in use by service %s/%s in current context",
                                            nodeport,
                                            item.get("metadata", {}).get("namespace"),
                                            item.get("metadata", {}).get("name"),
                                        )
                                        return True
                except Exception as exc:
                    self._logger.debug("Error checking current context for NodePort %d: %s", nodeport, exc)
            
            # Check each profile for services using this NodePort
            for profile in profiles:
                try:
                    # Get all services with NodePort type in all namespaces
                    result = subprocess.run(
                        [
                            "kubectl",
                            "get",
                            "svc",
                            "--all-namespaces",
                            "--context",
                            profile,
                            "-o",
                            "json",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    
                    if result.returncode == 0:
                        services_data = json.loads(result.stdout)
                        for item in services_data.get("items", []):
                            if item.get("spec", {}).get("type") == "NodePort":
                                ports = item.get("spec", {}).get("ports", [])
                                for port in ports:
                                    if port.get("nodePort") == nodeport:
                                        self._logger.debug(
                                            "NodePort %d is in use by service %s/%s in profile %s",
                                            nodeport,
                                            item.get("metadata", {}).get("namespace"),
                                            item.get("metadata", {}).get("name"),
                                            profile,
                                        )
                                        return True
                except Exception as exc:
                    self._logger.debug(
                        "Error checking profile %s for NodePort %d: %s", profile, nodeport, exc
                    )
                    continue
            
            return False
            
        except Exception as exc:
            self._logger.warning("Error checking NodePort availability: %s", exc)
            # On error, assume port is available to avoid blocking deployments
            return False

    def _find_available_nodeport(self, base_port: int) -> Optional[int]:
        """
        Find the next available NodePort starting from base_port.
        
        Args:
            base_port: Starting port to check (must be in range 30000-32767)
            
        Returns:
            First available NodePort, or None if no port is available
        """
        if base_port < 30000:
            base_port = 30000
        if base_port > 32767:
            self._logger.error("Base port %d is outside NodePort range (30000-32767)", base_port)
            return None
        
        current_port = base_port
        max_port = 32767
        
        while current_port <= max_port:
            if not self._is_nodeport_in_use(current_port):
                self._logger.info("Found available NodePort: %d", current_port)
                return current_port
            current_port += 1
        
        self._logger.error("No available NodePort found in range %d-%d", base_port, max_port)
        return None

    def _extract_nodeports_from_chart(self, chart_path: str) -> dict[str, int]:
        """
        Extract NodePort values from a helm chart.
        
        Uses helm show values to get default values, then searches for service.nodePort
        configurations. Handles multiple services in a chart.
        
        Args:
            chart_path: Path to the helm chart (local file or URL)
            
        Returns:
            Dictionary mapping service value paths to NodePort values.
            Example: {"service.nodePort": 30020, "services.app1.nodePort": 30021}
        """
        nodeports = {}
        
        try:
            # Use helm show values to get default values
            result = subprocess.run(
                ["helm", "show", "values", chart_path],
                capture_output=True,
                text=True,
                timeout=30,
            )
            
            if result.returncode != 0:
                self._logger.debug("Could not extract values from chart: %s", result.stderr)
                return nodeports
            
            if yaml is None:
                self._logger.warning("PyYAML not available, cannot parse chart values")
                return nodeports
            
            # Parse YAML values
            values = yaml.safe_load(result.stdout)
            if not values:
                return nodeports
            
            # Recursively search for nodePort values in the values structure
            def find_nodeports(obj: dict, path: str = "") -> None:
                """Recursively find nodePort values in nested dictionaries."""
                if not isinstance(obj, dict):
                    return
                
                for key, value in obj.items():
                    current_path = f"{path}.{key}" if path else key
                    
                    # Check if this is a nodePort field
                    if key == "nodePort" and isinstance(value, int):
                        # Check if parent is a service or services structure
                        if "service" in path.lower() or path == "":
                            nodeports[current_path] = value
                            self._logger.debug(
                                "Found NodePort %d at path: %s", value, current_path
                            )
                    
                    # Recursively search nested dictionaries
                    if isinstance(value, dict):
                        find_nodeports(value, current_path)
            
            find_nodeports(values)
            
            # Also check for common patterns like service.nodePort
            if "service" in values:
                service = values["service"]
                if isinstance(service, dict) and "nodePort" in service:
                    port = service["nodePort"]
                    if isinstance(port, int):
                        nodeports["service.nodePort"] = port
            
            # Check for services (plural) pattern
            if "services" in values:
                services = values["services"]
                if isinstance(services, dict):
                    for svc_name, svc_config in services.items():
                        if isinstance(svc_config, dict) and "nodePort" in svc_config:
                            port = svc_config["nodePort"]
                            if isinstance(port, int):
                                nodeports[f"services.{svc_name}.nodePort"] = port
            
        except Exception as exc:
            self._logger.warning("Error extracting NodePorts from chart: %s", exc)
        
        return nodeports

    def _resolve_nodeport_conflicts(
        self, chart_path: str
    ) -> tuple[list[str], dict[str, int]]:
        """
        Resolve NodePort conflicts for a helm chart and build --set flags.
        
        Args:
            chart_path: Path to the helm chart
            
        Returns:
            Tuple of (list of --set flag strings, dict of resolved NodePorts)
            Example: (["--set", "service.nodePort=30021"], {"service.nodePort": 30021})
        """
        set_flags = []
        resolved_ports = {}
        
        # Extract NodePort values from chart
        requested_nodeports = self._extract_nodeports_from_chart(chart_path)
        
        if not requested_nodeports:
            self._logger.debug("No NodePort values found in chart, skipping conflict resolution")
            return set_flags, resolved_ports
        
        self._logger.info(
            "Found %d NodePort configuration(s) in chart", len(requested_nodeports)
        )
        
        # Resolve each NodePort
        for value_path, requested_port in requested_nodeports.items():
            if not isinstance(requested_port, int):
                continue
            
            # Check if port is in use
            if self._is_nodeport_in_use(requested_port):
                self._logger.warning(
                    "NodePort %d (requested for %s) is already in use, finding alternative...",
                    requested_port,
                    value_path,
                )
                resolved_port = self._find_available_nodeport(requested_port)
                if resolved_port is None:
                    self._logger.error(
                        "Could not find available NodePort for %s, using requested port %d",
                        value_path,
                        requested_port,
                    )
                    resolved_port = requested_port
                else:
                    self._logger.info(
                        "Resolved NodePort conflict: %s %d -> %d",
                        value_path,
                        requested_port,
                        resolved_port,
                    )
            else:
                resolved_port = requested_port
                self._logger.debug(
                    "NodePort %d for %s is available", resolved_port, value_path
                )
            
            resolved_ports[value_path] = resolved_port
            
            # Build --set flag
            set_flags.extend(["--set", f"{value_path}={resolved_port}"])
        
        return set_flags, resolved_ports

    def _install_release(
        self,
        release_name: str,
        chart_path: str,
        namespace: str,
        intent_id: Optional[str] = None,
        p99_token_target: Optional[float] = None,
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

            # Resolve NodePort conflicts before installation
            nodeport_set_flags, resolved_nodeports = self._resolve_nodeport_conflicts(chart_path)
            if resolved_nodeports:
                self._logger.info(
                    "Resolved NodePort conflicts: %s", resolved_nodeports
                )

            # Build helm install command
            helm_cmd = [
                "helm",
                "install",
                release_name,
                chart_path,
                "--namespace",
                namespace,
                "--timeout",
                "5m",
            ]
            
            # Add NodePort override flags if any were resolved
            if nodeport_set_flags:
                helm_cmd.extend(nodeport_set_flags)

            # Install without --wait first, so we can patch ServiceAccounts before pods try to pull images
            result = subprocess.run(
                helm_cmd,
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
            # Create Ingress for LoadBalancer services
            self._create_ingress_for_loadbalancer_services(namespace, intent_id)
            # Log NodePort service access information (NodePort services are accessed directly, not via ingress)
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
        p99_token_target: Optional[float] = None,
    ) -> bool:
        """Upgrade an existing Helm release."""
        try:
            self._logger.info(
                "Upgrading Helm release %s in namespace %s for intent_id=%s",
                release_name,
                namespace,
                intent_id,
            )

            # Resolve NodePort conflicts before upgrade
            # Note: For upgrades, we should preserve existing NodePorts if they're still valid
            # But if the chart specifies new NodePorts, we need to resolve conflicts
            nodeport_set_flags, resolved_nodeports = self._resolve_nodeport_conflicts(chart_path)
            if resolved_nodeports:
                self._logger.info(
                    "Resolved NodePort conflicts for upgrade: %s", resolved_nodeports
                )

            # Build helm upgrade command
            helm_cmd = [
                "helm",
                "upgrade",
                release_name,
                chart_path,
                "--namespace",
                namespace,
                "--timeout",
                "5m",
            ]
            
            # Add NodePort override flags if any were resolved
            if nodeport_set_flags:
                helm_cmd.extend(nodeport_set_flags)

            # Upgrade without --wait first, so we can patch ServiceAccounts before pods try to pull images
            result = subprocess.run(
                helm_cmd,
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
            # Create Ingress for LoadBalancer services
            self._create_ingress_for_loadbalancer_services(namespace, intent_id)
            # Log NodePort service access information (NodePort services are accessed directly, not via ingress)
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
        """Note: Ingress creation for NodePort services is disabled.
        
        NodePort services should be accessed directly via their NodePort.
        Some applications (like open-webui) don't support subpath routing via ingress.
        Access information is logged via _log_service_access_info instead.
        """
        self._logger.debug(
            "Skipping ingress creation for NodePort services in namespace %s - "
            "NodePort services should be accessed directly",
            namespace,
        )

    def _create_ingress_for_loadbalancer_services(
        self, namespace: str, intent_id: Optional[str] = None
    ) -> None:
        """Create Ingress resources for LoadBalancer services in the namespace.
        
        This method detects all LoadBalancer services and creates Ingress rules
        that route traffic to them via the ingress controller.
        
        Args:
            namespace: Kubernetes namespace to check for LoadBalancer services
            intent_id: Optional intent ID for logging
        """
        if client is None:
            self._logger.debug(
                "Kubernetes client not available, skipping Ingress creation for LoadBalancer services"
            )
            return

        try:
            # Get all services in the namespace
            v1 = client.CoreV1Api()
            services = v1.list_namespaced_service(namespace=namespace)

            loadbalancer_services = []
            for svc in services.items:
                if svc.spec.type == "LoadBalancer":
                    # Get the first port (typically there's one main port)
                    for port in svc.spec.ports:
                        loadbalancer_services.append(
                            {
                                "name": svc.metadata.name,
                                "port": port.port,
                                "target_port": port.target_port,
                            }
                        )
                        # Only take the first port for now
                        break

            if not loadbalancer_services:
                self._logger.debug(
                    "No LoadBalancer services found in namespace %s (intent_id=%s)",
                    namespace,
                    intent_id,
                )
                return

            # Get networking API client for Ingress resources
            networking_v1 = client.NetworkingV1Api()

            for svc_info in loadbalancer_services:
                service_name = svc_info["name"]
                service_port = svc_info["port"]
                
                # Check if Ingress already exists
                ingress_name = service_name
                try:
                    existing_ingress = networking_v1.read_namespaced_ingress(
                        name=ingress_name, namespace=namespace
                    )
                    self._logger.debug(
                        "Ingress %s already exists in namespace %s, skipping creation",
                        ingress_name,
                        namespace,
                    )
                    continue
                except ApiException as exc:
                    if exc.status != 404:
                        # Some other error occurred
                        self._logger.warning(
                            "Error checking for existing Ingress %s in namespace %s: %s",
                            ingress_name,
                            namespace,
                            exc,
                        )
                        continue
                    # 404 means it doesn't exist, which is what we want

                # Create Ingress resource
                # Path pattern: /service-name(/|$)(.*) with rewrite to /$2
                path_pattern = f"/{service_name}(/|$)(.*)"
                
                ingress_body = client.V1Ingress(
                    metadata=client.V1ObjectMeta(
                        name=ingress_name,
                        namespace=namespace,
                        annotations={
                            "nginx.ingress.kubernetes.io/rewrite-target": "/$2",
                            "nginx.ingress.kubernetes.io/use-regex": "true",
                        },
                    ),
                    spec=client.V1IngressSpec(
                        ingress_class_name="nginx",
                        rules=[
                            client.V1IngressRule(
                                http=client.V1HTTPIngressRuleValue(
                                    paths=[
                                        client.V1HTTPIngressPath(
                                            path=path_pattern,
                                            path_type="ImplementationSpecific",
                                            backend=client.V1IngressBackend(
                                                service=client.V1IngressServiceBackend(
                                                    name=service_name,
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
                        namespace=namespace, body=ingress_body
                    )
                    self._logger.info(
                        "Created Ingress %s for LoadBalancer service %s (port %s) in namespace %s (intent_id=%s)",
                        ingress_name,
                        service_name,
                        service_port,
                        namespace,
                        intent_id,
                    )
                    
                    # Log the access URL
                    # Get ingress controller NodePort to construct the URL
                    try:
                        ingress_svc = v1.read_namespaced_service(
                            name="ingress-nginx-controller", namespace="ingress-nginx"
                        )
                        ingress_nodeport = None
                        for port in ingress_svc.spec.ports:
                            if port.port == 80:
                                ingress_nodeport = port.node_port
                                break
                        
                        if ingress_nodeport:
                            # Try to get external hostname/IP
                            external_host = None
                            try:
                                result = subprocess.run(
                                    ["hostname", "-f"],
                                    capture_output=True,
                                    text=True,
                                    timeout=5,
                                )
                                if result.returncode == 0:
                                    hostname = result.stdout.strip()
                                    if "." in hostname and hostname != "localhost":
                                        external_host = hostname
                            except Exception:
                                pass
                            
                            if not external_host:
                                try:
                                    result = subprocess.run(
                                        ["ip", "-o", "addr", "show"],
                                        capture_output=True,
                                        text=True,
                                        timeout=5,
                                    )
                                    if result.returncode == 0:
                                        matches = re.findall(
                                            r"inet\s+(129\.242\.\d+\.\d+)", result.stdout
                                        )
                                        if matches:
                                            external_host = matches[0]
                                except Exception:
                                    pass
                            
                            if external_host:
                                ingress_url = f"http://{external_host}:{ingress_nodeport}/{service_name}"
                            else:
                                minikube_ip = "192.168.49.2"
                                try:
                                    result = subprocess.run(
                                        ["minikube", "ip"],
                                        capture_output=True,
                                        text=True,
                                        timeout=5,
                                    )
                                    if result.returncode == 0:
                                        minikube_ip = result.stdout.strip()
                                except Exception:
                                    pass
                                ingress_url = f"http://{minikube_ip}:{ingress_nodeport}/{service_name}"
                            
                            self._logger.info(
                                "  Ingress URL for service %s: %s",
                                service_name,
                                ingress_url,
                            )
                    except Exception as exc:
                        self._logger.debug(
                            "Could not determine ingress controller NodePort for URL logging: %s",
                            exc,
                        )

                except ApiException as exc:
                    if exc.status == 409:
                        # Ingress already exists (race condition)
                        self._logger.debug(
                            "Ingress %s already exists in namespace %s (created concurrently)",
                            ingress_name,
                            namespace,
                        )
                    else:
                        self._logger.warning(
                            "Failed to create Ingress %s for service %s in namespace %s: %s",
                            ingress_name,
                            service_name,
                            namespace,
                            exc,
                        )
                except Exception as exc:
                    self._logger.error(
                        "Unexpected error creating Ingress %s for service %s in namespace %s: %s",
                        ingress_name,
                        service_name,
                        namespace,
                        exc,
                        exc_info=True,
                    )

        except Exception as exc:
            self._logger.warning(
                "Could not create Ingress for LoadBalancer services in namespace %s (intent_id=%s): %s",
                namespace,
                intent_id,
                exc,
            )

    def _create_ido_intent_and_kpi_profile(
        self,
        namespace: str,
        intent_id: Optional[str] = None,
        p99_token_target: Optional[float] = None,
        prometheus_endpoint: Optional[str] = None,
    ) -> None:
        """Create IDO Intent and KPIProfile resources for the deployed application.
        
        Args:
            namespace: Kubernetes namespace where the application is deployed
            intent_id: The TMF intent ID
            p99_token_target: The p99-token-target value in seconds (from TMF intent)
            prometheus_endpoint: Prometheus query endpoint URL. If None, will use PROMETHEUS_URL 
                                 environment variable or default to http://start5g-1.cs.uit.no:9090/api/v1/query
        """
        # Get Prometheus endpoint from parameter, environment variable, or use default
        if prometheus_endpoint is None:
            # Check if running inside Kubernetes cluster (in-cluster config available)
            # If so, prefer Kubernetes service DNS name for better connectivity
            try:
                if client is not None:
                    try:
                        kube_config.load_incluster_config()
                        # Running inside cluster - use Kubernetes service
                        prometheus_endpoint = os.getenv(
                            "PROMETHEUS_URL",
                            "http://prometheus.default.svc.cluster.local:9090"
                        )
                    except ConfigException:
                        # Running outside cluster - use external URL
                        prometheus_endpoint = os.getenv(
                            "PROMETHEUS_URL",
                            "http://start5g-1.cs.uit.no:9090"
                        )
                else:
                    # Kubernetes client not available - use external URL
                    prometheus_endpoint = os.getenv(
                        "PROMETHEUS_URL",
                        "http://start5g-1.cs.uit.no:9090"
                    )
            except Exception:
                # Fallback to external URL if detection fails
                prometheus_endpoint = os.getenv(
                    "PROMETHEUS_URL",
                    "http://start5g-1.cs.uit.no:9090"
                )
            # Ensure it ends with /api/v1/query
            if not prometheus_endpoint.endswith("/api/v1/query"):
                prometheus_endpoint = prometheus_endpoint.rstrip("/") + "/api/v1/query"
        if client is None:
            self._logger.debug("Kubernetes client not available, skipping IDO Intent creation")
            return
        
        if p99_token_target is None:
            self._logger.debug("No p99-token-target provided, skipping IDO Intent creation")
            return
        
        try:
            # Use CustomObjectsApi for IDO CRDs
            custom_api = client.CustomObjectsApi()
            
            # Determine the deployment name (typically matches namespace or release name)
            # Try to find the deployment in the namespace
            apps_v1 = client.AppsV1Api()
            deployments = apps_v1.list_namespaced_deployment(namespace=namespace)
            
            deployment_name = None
            if deployments.items:
                # Use the first deployment found (or you could filter by labels)
                deployment_name = deployments.items[0].metadata.name
            else:
                # Fallback: use namespace as deployment name
                deployment_name = namespace
            
            # Create KPIProfile first
            kpi_profile_name = f"p99token-{namespace}"
            kpi_profile_body = {
                "apiVersion": "ido.intel.com/v1alpha1",
                "kind": "KPIProfile",
                "metadata": {
                    "name": kpi_profile_name,
                    "namespace": namespace,
                },
                "spec": {
                    "type": "latency",
                    "description": "token creation time (p99 percentile)",
                    "query": "histogram_quantile(0.99, sum(rate(token_creation_duration_bucket[30s])) by (le))",
                    "props": {
                        "endpoint": prometheus_endpoint,
                    },
                },
            }
            
            # Log the KPIProfile YAML
            if yaml:
                kpi_profile_yaml = yaml.dump(kpi_profile_body, default_flow_style=False, sort_keys=False)
            else:
                kpi_profile_yaml = json.dumps(kpi_profile_body, indent=2)
            self._logger.info(
                "Creating KPIProfile %s in namespace %s for intent_id=%s:\n%s",
                kpi_profile_name,
                namespace,
                intent_id,
                kpi_profile_yaml,
            )
            
            try:
                custom_api.create_namespaced_custom_object(
                    group="ido.intel.com",
                    version="v1alpha1",
                    namespace=namespace,
                    plural="kpiprofiles",
                    body=kpi_profile_body,
                )
                self._logger.info(
                    "Created KPIProfile %s in namespace %s for intent_id=%s",
                    kpi_profile_name,
                    namespace,
                    intent_id,
                )
            except ApiException as exc:
                if exc.status == 409:
                    self._logger.debug(
                        "KPIProfile %s already exists in namespace %s",
                        kpi_profile_name,
                        namespace,
                    )
                else:
                    self._logger.warning(
                        "Failed to create KPIProfile %s: %s",
                        kpi_profile_name,
                        exc,
                    )
                    return
            
            # Create IDO Intent
            ido_intent_name = f"llm-intent-{namespace}"
            ido_intent_body = {
                "apiVersion": "ido.intel.com/v1alpha1",
                "kind": "Intent",
                "metadata": {
                    "name": ido_intent_name,
                    "namespace": namespace,
                },
                "spec": {
                    "targetRef": {
                        "kind": "Deployment",
                        "name": f"{namespace}/{deployment_name}",
                    },
                    "priority": 1.0,
                    "objectives": [
                        {
                            "name": "p99-token-target",
                            "value": p99_token_target,  # Use p99-token-target from TMF intent
                            "measuredBy": f"{namespace}/{kpi_profile_name}",
                        }
                    ],
                },
            }
            
            # Log the IDO Intent YAML
            if yaml:
                ido_intent_yaml = yaml.dump(ido_intent_body, default_flow_style=False, sort_keys=False)
            else:
                ido_intent_yaml = json.dumps(ido_intent_body, indent=2)
            self._logger.info(
                "Creating IDO Intent %s in namespace %s for intent_id=%s (p99-target=%.3f):\n%s",
                ido_intent_name,
                namespace,
                intent_id,
                p99_token_target,
                ido_intent_yaml,
            )
            
            try:
                custom_api.create_namespaced_custom_object(
                    group="ido.intel.com",
                    version="v1alpha1",
                    namespace=namespace,
                    plural="intents",
                    body=ido_intent_body,
                )
                self._logger.info(
                    "Created IDO Intent %s in namespace %s for intent_id=%s (p99-target=%.3f)",
                    ido_intent_name,
                    namespace,
                    intent_id,
                    p99_token_target,
                )
            except ApiException as exc:
                if exc.status == 409:
                    self._logger.debug(
                        "IDO Intent %s already exists in namespace %s",
                        ido_intent_name,
                        namespace,
                    )
                else:
                    self._logger.warning(
                        "Failed to create IDO Intent %s: %s",
                        ido_intent_name,
                        exc,
                    )
        
        except Exception as exc:
            self._logger.warning(
                "Could not create IDO Intent and KPIProfile for namespace %s (intent_id=%s): %s",
                namespace,
                intent_id,
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
                    # Try to get external hostname/IP (host that's accessible from outside)
                    external_host = None
                    try:
                        # Try to get hostname first (e.g., start5g-1.cs.uit.no)
                        result = subprocess.run(
                            ["hostname", "-f"],
                            capture_output=True,
                            text=True,
                            timeout=5,
                        )
                        if result.returncode == 0:
                            hostname = result.stdout.strip()
                            # Use hostname if it's a FQDN (contains dots)
                            if "." in hostname and hostname != "localhost":
                                external_host = hostname
                    except Exception:
                        pass
                    
                    # If no hostname, try to detect external IP
                    if not external_host:
                        try:
                            # Try to detect host external IP (similar to setup script)
                            result = subprocess.run(
                                ["ip", "-o", "addr", "show"],
                                capture_output=True,
                                text=True,
                                timeout=5,
                            )
                            if result.returncode == 0:
                                # Look for IP in 129.242.x.x range (typical external IP pattern)
                                matches = re.findall(r"inet\s+(129\.242\.\d+\.\d+)", result.stdout)
                                if matches:
                                    external_host = matches[0]
                        except Exception:
                            pass
                    
                    # Fall back to minikube IP if external host/IP not found
                    if not external_host:
                        minikube_ip = "192.168.49.2"  # Default minikube IP
                        try:
                            result = subprocess.run(
                                ["minikube", "ip"],
                                capture_output=True,
                                text=True,
                                timeout=5,
                            )
                            if result.returncode == 0:
                                minikube_ip = result.stdout.strip()
                        except Exception:
                            pass  # Use default
                        access_url = f"http://{minikube_ip}:{svc_info['node_port']}/"
                    else:
                        access_url = f"http://{external_host}:{svc_info['node_port']}/"

                    # Log prominently
                    self._logger.info(
                        "=" * 70
                    )
                    self._logger.info(
                        "  Service: %s - NodePort: %s",
                        svc_info["name"],
                        svc_info["node_port"],
                    )
                    self._logger.info(
                        "  Application URL: %s",
                        access_url,
                    )
                    self._logger.info(
                        "=" * 70
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
