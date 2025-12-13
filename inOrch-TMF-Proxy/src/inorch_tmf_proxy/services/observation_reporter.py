from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional, Dict, List, Any
from uuid import uuid4
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    requests = None  # type: ignore

try:
    from intent_report_client import GraphDbClient
except ImportError:
    GraphDbClient = None  # type: ignore

from inorch_tmf_proxy.config import AppConfig
from inorch_tmf_proxy.services.turtle_parser import TurtleParser


class ObservationReporter:
    """
    Service for generating and storing observation reports from KPIProfile queries.
    
    This service:
    1. Queries Prometheus using KPIProfile queries
    2. Formats results as TMF observation reports
    3. Stores reports in GraphDB
    """

    def __init__(self, config: AppConfig, graphdb_client: Optional["GraphDbClient"] = None):
        """
        Initialize the ObservationReporter.
        
        Args:
            config: Application configuration
            graphdb_client: GraphDB client for storing reports (optional, will create if not provided)
        """
        self._config = config
        self._logger = logging.getLogger(self.__class__.__name__)
        self._turtle_parser = TurtleParser()
        
        # Initialize GraphDB client
        if graphdb_client:
            self._graphdb_client = graphdb_client
        elif GraphDbClient and config.enable_graphdb:
            self._graphdb_client = GraphDbClient(
                base_url=config.graphdb_base_url,
                repository=config.graphdb_repository
            )
        else:
            self._graphdb_client = None
            self._logger.warning("GraphDB client not available, observation reports will not be stored")
        
        # Track active reporting threads: {intent_id: {kpi_name: thread_info}}
        self._active_threads: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._thread_lock = threading.Lock()
        
        # Track which metrics have had metadata stored (to avoid duplicates)
        self._metadata_stored: set[str] = set()
        self._metadata_lock = threading.Lock()
        
        # Default reporting frequency (can be overridden per KPIProfile)
        self._default_frequency = getattr(config, 'observation_reporting_frequency', 30)
        
        # Prometheus query settings
        self._prometheus_timeout = getattr(config, 'prometheus_query_timeout', 10)
        self._prometheus_retries = getattr(config, 'prometheus_retry_attempts', 3)

    def start_reporting_for_intent(
        self,
        intent_id: str,
        namespace: str,
        kpi_profiles: List[Dict],
        turtle_data: str,
        ido_intent: Optional[Dict] = None
    ) -> None:
        """
        Start observation reporting for an intent.
        
        Creates a reporting thread for each KPIProfile that can be mapped to a TMF condition.
        
        Args:
            intent_id: TMF Intent ID
            namespace: Kubernetes namespace
            kpi_profiles: List of KPIProfile dictionaries from helm_deployer
            turtle_data: TMF Intent Turtle RDF data
            ido_intent: Optional IDO Intent resource (for mapping KPIProfiles to objectives)
        """
        if not self._config.enable_graphdb or not self._graphdb_client:
            self._logger.debug("GraphDB not enabled, skipping observation reporting")
            return
        
        if not kpi_profiles:
            self._logger.debug("No KPIProfiles provided for intent_id=%s", intent_id)
            return
        
        self._logger.info(
            "Starting observation reporting for intent_id=%s with %d KPIProfile(s)",
            intent_id,
            len(kpi_profiles)
        )
        
        # Get IDO Intent if not provided (needed for mapping)
        if not ido_intent:
            ido_intent = self._get_ido_intent(namespace)
        
        with self._thread_lock:
            if intent_id not in self._active_threads:
                self._active_threads[intent_id] = {}
        
        # Start reporting thread for each KPIProfile
        for kpi_profile in kpi_profiles:
            kpi_name = kpi_profile.get("name")
            if not kpi_name:
                self._logger.warning("KPIProfile missing name, skipping")
                continue
            
            # Map KPIProfile to TMF condition
            condition_id = self._map_kpi_to_condition(kpi_profile, ido_intent, turtle_data)
            if not condition_id:
                self._logger.warning(
                    "Could not map KPIProfile %s to TMF condition, skipping reporting",
                    kpi_name
                )
                continue
            
            # Get reporting frequency for this KPIProfile
            frequency = self._get_reporting_frequency(kpi_profile, self._default_frequency)
            
            # Create and start reporting thread
            thread_info = {
                "thread": None,
                "kpi_profile": kpi_profile,
                "condition_id": condition_id,
                "namespace": namespace,
                "running": True
            }
            
            thread = threading.Thread(
                target=self._report_observations_loop,
                args=(intent_id, kpi_profile, condition_id, turtle_data, namespace, frequency),
                daemon=True
            )
            thread.start()
            thread_info["thread"] = thread
            
            with self._thread_lock:
                self._active_threads[intent_id][kpi_name] = thread_info
            
            # Store GraphDB query metadata for this metric (only once)
            objective_name = self._extract_objective_name_from_condition(condition_id, turtle_data)
            if objective_name:
                metric_name = f"{objective_name}_{condition_id}"
                self._store_graphdb_query_metadata(metric_name)
            
            self._logger.info(
                "Started observation reporting thread for intent_id=%s, KPIProfile=%s, condition_id=%s, frequency=%ds",
                intent_id,
                kpi_name,
                condition_id,
                frequency
            )

    def stop_reporting_for_intent(self, intent_id: str) -> None:
        """
        Stop observation reporting for an intent.
        
        Args:
            intent_id: TMF Intent ID
        """
        with self._thread_lock:
            if intent_id not in self._active_threads:
                self._logger.debug("No active reporting threads for intent_id=%s", intent_id)
                return
            
            thread_infos = self._active_threads[intent_id]
            for kpi_name, thread_info in thread_infos.items():
                thread_info["running"] = False
                self._logger.debug(
                    "Stopped reporting thread for intent_id=%s, KPIProfile=%s",
                    intent_id,
                    kpi_name
                )
            
            del self._active_threads[intent_id]
        
        self._logger.info("Stopped all observation reporting for intent_id=%s", intent_id)

    def _get_ido_intent(self, namespace: str) -> Optional[Dict]:
        """Get IDO Intent from namespace (for mapping KPIProfiles to objectives)."""
        try:
            from kubernetes import client
            from kubernetes.client import ApiException
            
            custom_api = client.CustomObjectsApi()
            
            # Try common naming patterns
            intent_names_to_try = [
                f"llm-intent-{namespace}",
                "llm-intent",
            ]
            
            for candidate_name in intent_names_to_try:
                try:
                    intent = custom_api.get_namespaced_custom_object(
                        group="ido.intel.com",
                        version="v1alpha1",
                        namespace=namespace,
                        plural="intents",
                        name=candidate_name,
                    )
                    if intent.get("kind") == "Intent" and intent.get("apiVersion") == "ido.intel.com/v1alpha1":
                        return intent
                except ApiException as exc:
                    if exc.status == 404:
                        continue
                    raise
            
            # Try to get any Intent
            intents_list = custom_api.list_namespaced_custom_object(
                group="ido.intel.com",
                version="v1alpha1",
                namespace=namespace,
                plural="intents",
            )
            intent_items = intents_list.get("items", [])
            if intent_items:
                return intent_items[0]
            
            return None
        except Exception as exc:
            self._logger.warning("Failed to get IDO Intent from namespace %s: %s", namespace, exc)
            return None

    def _map_kpi_to_condition(
        self,
        kpi_profile: Dict,
        ido_intent: Optional[Dict],
        turtle_data: str
    ) -> Optional[str]:
        """
        Map KPIProfile to TMF Intent condition ID.
        
        Mapping logic:
        1. Get KPIProfile name (e.g., "p99token")
        2. Find IDO Intent objective with measuredBy matching "intend/{kpi_name}"
        3. Extract objective name (e.g., "p99-token-target")
        4. Find TMF Intent condition with valuesOfTargetProperty matching objective name
        5. Return condition ID
        
        Args:
            kpi_profile: KPIProfile dictionary
            ido_intent: IDO Intent resource (optional)
            turtle_data: TMF Intent Turtle RDF data
            
        Returns:
            Condition ID if mapping found, None otherwise
        """
        kpi_name = kpi_profile.get("name")
        if not kpi_name:
            return None
        
        # Step 1: Find IDO Intent objective with measuredBy matching "intend/{kpi_name}"
        objective_name = None
        if ido_intent:
            objectives = ido_intent.get("spec", {}).get("objectives", [])
            for obj in objectives:
                measured_by = obj.get("measuredBy", "")
                # measuredBy format: "intend/p99token" or "intend/{kpi_name}"
                if measured_by == f"intend/{kpi_name}" or measured_by.endswith(f"/{kpi_name}"):
                    objective_name = obj.get("name")
                    self._logger.debug(
                        "Mapped KPIProfile %s to objective %s via measuredBy %s",
                        kpi_name,
                        objective_name,
                        measured_by
                    )
                    break
        
        if not objective_name:
            self._logger.debug(
                "Could not find IDO Intent objective for KPIProfile %s",
                kpi_name
            )
            return None
        
        # Step 2: Find TMF Intent condition with valuesOfTargetProperty matching objective_name
        try:
            from rdflib import Graph, URIRef
            from rdflib.namespace import RDF
            
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            
            icm_condition = URIRef(f"{TurtleParser.ICM_NS}Condition")
            set_forall = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/forAll")
            icm_values_of_target_prop = URIRef(f"{TurtleParser.ICM_NS}valuesOfTargetProperty")
            data5g_ns = TurtleParser.DATA5G_NS
            
            # Find all Conditions
            for condition in graph.subjects(RDF.type, icm_condition):
                # Extract condition ID from URI (e.g., data5g:COabc123 -> COabc123)
                condition_uri_str = str(condition)
                if condition_uri_str.startswith(data5g_ns):
                    condition_id = condition_uri_str[len(data5g_ns):]
                else:
                    continue
                
                # Check if this condition has valuesOfTargetProperty matching objective_name
                forall_objects = list(graph.objects(condition, set_forall))
                for forall_obj in forall_objects:
                    target_props = list(graph.objects(forall_obj, icm_values_of_target_prop))
                    for target_prop in target_props:
                        target_prop_str = str(target_prop)
                        # Check if target property matches objective name
                        if objective_name in target_prop_str or target_prop_str.endswith(objective_name):
                            self._logger.debug(
                                "Mapped objective %s to condition %s",
                                objective_name,
                                condition_id
                            )
                            return condition_id
            
            self._logger.warning(
                "Could not find TMF condition for objective %s (from KPIProfile %s)",
                objective_name,
                kpi_name
            )
            return None
            
        except Exception as exc:
            self._logger.warning(
                "Error mapping KPIProfile %s to condition: %s",
                kpi_name,
                exc
            )
            return None

    def _get_reporting_frequency(self, kpi_profile: Dict, default_frequency: int) -> int:
        """
        Get reporting frequency for a KPIProfile.
        
        Args:
            kpi_profile: KPIProfile dictionary
            default_frequency: Default frequency from config
            
        Returns:
            Reporting frequency in seconds (validated to be between 5-300)
        """
        frequency = kpi_profile.get("reportingFrequency")
        if frequency is None:
            frequency = default_frequency
        
        # Validate frequency
        if frequency < 5:
            self._logger.warning(
                "Reporting frequency %d too low, using minimum of 5 seconds",
                frequency
            )
            frequency = 5
        elif frequency > 300:
            self._logger.warning(
                "Reporting frequency %d too high, using maximum of 300 seconds",
                frequency
            )
            frequency = 300
        
        return int(frequency)

    def _determine_unit(self, kpi_profile: Dict, turtle_data: str, condition_id: str, objective_name: Optional[str] = None) -> str:
        """
        Determine the unit for a metric, respecting unit conversions.
        
        If the TMF Intent specified a unit that was converted (e.g., ms -> seconds),
        use the converted unit in observation reports.
        
        Args:
            kpi_profile: KPIProfile dictionary
            turtle_data: TMF Intent Turtle RDF data
            condition_id: Condition ID
            objective_name: Optional objective name (e.g., "p99-token-target")
            
        Returns:
            Unit string (e.g., "s" if converted from ms, "ms" if not converted, "Mbps" for bandwidth)
        """
        # First, check if we have parsed objectives with unit conversion information
        if objective_name:
            try:
                objectives = self._turtle_parser.parse_deployment_expectation_objectives(turtle_data)
                if objective_name in objectives:
                    obj_info = objectives[objective_name]
                    original_unit = obj_info.get("unit", "").lower()
                    converted_value = obj_info.get("value")
                    original_value = obj_info.get("original_value")
                    
                    # If unit was "ms" and we converted to seconds (value changed)
                    if original_unit == "ms" and converted_value is not None and original_value is not None:
                        if abs(converted_value - (original_value / 1000.0)) < 0.001:
                            # Conversion was done: ms -> seconds
                            self._logger.debug(
                                "Unit conversion detected: %s %s -> %.3f s, using 's' in observation reports",
                                original_value,
                                original_unit,
                                converted_value
                            )
                            return "s"
                        else:
                            # No conversion, use original unit
                            return original_unit
                    elif original_unit in ["s", "sec", "seconds"]:
                        # Already in seconds
                        return "s"
                    elif original_unit in ["mbps", "mb/s"]:
                        # Bandwidth
                        return "Mbps"
            except Exception as exc:
                self._logger.debug(
                    "Could not determine unit from parsed objectives: %s",
                    exc
                )
        
        # Fallback: Check KPIProfile type
        kpi_type = kpi_profile.get("type", "").lower()
        if kpi_type == "latency":
            # For latency, check if we should use seconds (if values are typically < 1)
            # But we can't know for sure without the parsed objectives, so default to ms
            # However, if we have objective_name, we already tried above
            return "ms"
        elif kpi_type == "bandwidth":
            return "Mbps"
        
        # Try to extract from TMF Intent condition directly
        try:
            from rdflib import Graph, URIRef
            from rdflib.namespace import RDF
            
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            
            data5g_ns = TurtleParser.DATA5G_NS
            condition_uri = URIRef(f"{data5g_ns}{condition_id}")
            icm_condition = URIRef(f"{TurtleParser.ICM_NS}Condition")
            set_forall = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/forAll")
            quan_smaller = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/smaller")
            quan_unit = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/unit")
            rdf_value = URIRef("http://www.w3.org/1999/02/22-rdf-syntax-ns#value")
            
            # Check if condition exists
            if (condition_uri, RDF.type, icm_condition) in graph:
                # Find forAll objects and extract unit from quan:smaller
                forall_objects = list(graph.objects(condition_uri, set_forall))
                for forall_obj in forall_objects:
                    smaller_objects = list(graph.objects(forall_obj, quan_smaller))
                    for smaller_obj in smaller_objects:
                        # Get the unit
                        for unit_obj in graph.objects(smaller_obj, quan_unit):
                            if hasattr(unit_obj, 'value'):
                                unit_str = str(unit_obj.value).lower()
                                # If unit is ms, we convert to seconds, so use "s"
                                if unit_str == "ms":
                                    return "s"
                                elif unit_str in ["s", "sec", "seconds"]:
                                    return "s"
                                elif unit_str in ["mbps", "mb/s"]:
                                    return "Mbps"
                                return unit_str
        except Exception:
            pass
        
        # Default to ms (but this should rarely happen if objectives were parsed correctly)
        return "ms"

    def _query_prometheus(self, query: str, endpoint: str, namespace: str) -> Dict[str, Any]:
        """
        Query Prometheus using the provided query and endpoint.
        
        Tries KPIProfile endpoint first, then falls back to Kubernetes service URLs.
        
        Args:
            query: Prometheus query string
            endpoint: Prometheus API endpoint URL
            namespace: Kubernetes namespace (for fallback service URLs)
            
        Returns:
            Dictionary with:
            - success: bool
            - value: float (if successful)
            - timestamp: float (Unix epoch, if successful)
            - error: str (if failed)
            - message: str (if no results)
        """
        if not requests:
            return {
                "success": False,
                "error": "requests library not available"
            }
        
        # Try endpoints in order: original endpoint, then Kubernetes service
        endpoints_to_try = [endpoint]
        
        # Add Kubernetes service URL as fallback
        if namespace:
            service_urls = [
                f"http://prometheus.{namespace}.svc.cluster.local:9090/api/v1/query",
                "http://prometheus.default.svc.cluster.local:9090/api/v1/query",
            ]
            endpoints_to_try.extend(service_urls)
        
        last_error = None
        
        for endpoint_to_try in endpoints_to_try:
            try:
                # Parse the endpoint
                parsed = urlparse(endpoint_to_try)
                
                if "/api/v1/query" in endpoint_to_try:
                    query_url = endpoint_to_try
                else:
                    base_url = f"{parsed.scheme}://{parsed.netloc}"
                    query_url = f"{base_url}/api/v1/query"
                
                # Execute the Prometheus query
                response = requests.get(
                    query_url,
                    params={"query": query},
                    timeout=self._prometheus_timeout
                )
                
                if response.status_code != 200:
                    last_error = f"HTTP {response.status_code}: {response.text[:200]}"
                    continue
                
                data = response.json()
                
                if data.get("status") != "success":
                    last_error = f"Prometheus query failed: {data.get('error', 'Unknown error')}"
                    continue
                
                result_data = data.get("data", {})
                result_type = result_data.get("resultType")
                results = result_data.get("result", [])
                
                if not results:
                    return {
                        "success": True,
                        "value": None,
                        "message": "Query returned no results (metric may not be available yet)"
                    }
                
                # Extract the metric value
                if result_type == "vector" and results:
                    first_result = results[0]
                    value_str = first_result.get("value", [None, "0"])[1]
                    try:
                        value = float(value_str)
                        timestamp = first_result.get("value", [None, None])[0]
                        return {
                            "success": True,
                            "value": value,
                            "timestamp": float(timestamp) if timestamp else None
                        }
                    except (ValueError, TypeError) as e:
                        last_error = f"Could not parse metric value '{value_str}': {e}"
                        continue
                else:
                    return {
                        "success": True,
                        "value": None,
                        "message": f"Unhandled result type: {result_type}"
                    }
                    
            except requests.exceptions.RequestException as e:
                last_error = f"Failed to connect: {e}"
                continue
            except Exception as e:
                last_error = f"Unexpected error: {e}"
                continue
        
        # All endpoints failed
        return {
            "success": False,
            "error": f"All endpoints failed. Last error: {last_error}"
        }

    def _extract_objective_name_from_condition(
        self,
        condition_id: str,
        turtle_data: str
    ) -> Optional[str]:
        """
        Extract the objective name from a condition's valuesOfTargetProperty.
        
        Args:
            condition_id: TMF Intent condition ID (e.g., "COc3f4513c2c7e424a815c197cd50fdeeb")
            turtle_data: TMF Intent Turtle RDF data
            
        Returns:
            Objective name (e.g., "p99-token-target") or None if not found
        """
        try:
            from rdflib import Graph, URIRef
            from rdflib.namespace import RDF
            
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            
            data5g_ns = TurtleParser.DATA5G_NS
            condition_uri = URIRef(f"{data5g_ns}{condition_id}")
            icm_condition = URIRef(f"{TurtleParser.ICM_NS}Condition")
            set_forall = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/forAll")
            icm_values_of_target_prop = URIRef(f"{TurtleParser.ICM_NS}valuesOfTargetProperty")
            
            # Check if condition exists
            if (condition_uri, RDF.type, icm_condition) in graph:
                # Find forAll objects in this condition
                forall_objects = list(graph.objects(condition_uri, set_forall))
                for forall_obj in forall_objects:
                    # Extract valuesOfTargetProperty
                    target_props = list(graph.objects(forall_obj, icm_values_of_target_prop))
                    for target_prop in target_props:
                        # Extract objective name from the property URI
                        objective_name = self._turtle_parser._extract_objective_name(target_prop)
                        if objective_name:
                            self._logger.debug(
                                "Extracted objective name %s from condition %s",
                                objective_name,
                                condition_id
                            )
                            return objective_name
            
            return None
        except Exception as exc:
            self._logger.warning(
                "Error extracting objective name from condition %s: %s",
                condition_id,
                exc
            )
            return None

    def _generate_observation_turtle(
        self,
        intent_id: str,
        condition_id: str,
        metric_value: float,
        timestamp: datetime,
        turtle_data: str,
        unit: str
    ) -> str:
        """
        Generate a TMF observation report in Turtle format.
        
        The observedMetric uses the format: data5g:{objective_name}_{condition_id}
        where objective_name comes from the condition's valuesOfTargetProperty.
        
        Args:
            intent_id: TMF Intent ID
            condition_id: TMF Intent condition ID (e.g., "COc3f4513c2c7e424a815c197cd50fdeeb")
            metric_value: Metric value from Prometheus
            timestamp: Timestamp of the observation
            turtle_data: TMF Intent Turtle RDF data (for extracting objective name)
            unit: Unit of the metric
            
        Returns:
            Turtle format string for the observation
        """
        observation_id = f"OB{uuid4().hex[:16]}"
        timestamp_str = timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        # Extract objective name from the condition's valuesOfTargetProperty
        # Example: condition has valuesOfTargetProperty data5g:p99-token-target
        # We extract "p99-token-target" as the objective name
        objective_name = self._extract_objective_name_from_condition(condition_id, turtle_data)
        
        if not objective_name:
            self._logger.warning(
                "Could not extract objective name from condition %s, using fallback",
                condition_id
            )
            # Fallback: try to get from parsed objectives
            try:
                objectives = self._turtle_parser.parse_deployment_expectation_objectives(turtle_data)
                for obj_name in objectives.keys():
                    objective_name = obj_name
                    break
            except Exception:
                pass
            
            if not objective_name:
                objective_name = f"metric_{condition_id}"
        
        # Format as TMF observation
        # Format: data5g:{objective_name}_{condition_id}
        # Example: data5g:p99-token-target_COc3f4513c2c7e424a815c197cd50fdeeb
        turtle = f"""@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix data5g: <http://5g4data.eu/5g4data#> .

data5g:{observation_id} a met:Observation ;
    met:observedMetric data5g:{objective_name}_{condition_id} ;
    met:observedValue [ rdf:value {metric_value:.3f} ; quan:unit "{unit}" ] ;
    met:obtainedAt "{timestamp_str}"^^xsd:dateTime ."""
        
        return turtle

    def _store_graphdb_query_metadata(self, metric_name: str) -> None:
        """
        Store GraphDB query metadata for a metric in the metadata graph.
        
        This stores a SPARQL query that can be used to retrieve observations
        for this metric, similar to IntentReport-Simulator.
        
        Args:
            metric_name: The metric name (e.g., "p99-token-target_COc3f4513c2c7e424a815c197cd50fdeeb")
        """
        if not self._graphdb_client:
            return
        
        # Check if metadata already stored for this metric
        with self._metadata_lock:
            if metric_name in self._metadata_stored:
                self._logger.debug(
                    "GraphDB query metadata already stored for metric %s",
                    metric_name
                )
                return
            self._metadata_stored.add(metric_name)
        
        try:
            # Use GraphDbClient's store_graphdb_metadata method if available
            if hasattr(self._graphdb_client, 'store_graphdb_metadata'):
                try:
                    success = self._graphdb_client.store_graphdb_metadata(metric_name)
                    if success:
                        self._logger.info(
                            "Successfully stored GraphDB query metadata for metric %s",
                            metric_name
                        )
                    else:
                        self._logger.warning(
                            "Failed to store GraphDB query metadata for metric %s",
                            metric_name
                        )
                    return
                except Exception as exc:
                    self._logger.warning(
                        "Error using GraphDbClient.store_graphdb_metadata for metric %s: %s",
                        metric_name,
                        exc
                    )
                    # Fall through to manual implementation
            
            # Manual implementation (fallback or if method not available)
            # Create the SPARQL query pattern with the metric name substituted
            sparql_query = f"""
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
WHERE {{
  SERVICE <repository:{self._graphdb_client.repository}> {{
    BIND(IRI(CONCAT("http://5g4data.eu/5g4data#", "{metric_name}")) AS ?metric)

    ?observation a met:Observation ;
            met:observedMetric ?metric ;
            met:observedValue ?blankValue ;
            met:obtainedAt ?timestamp .

    ?blankValue rdf:value ?rawValue ;
            quan:unit ?unit .

    BIND(xsd:decimal(?rawValue) AS ?value)
  }}
}}
ORDER BY ?timestamp
"""
            
            # URL encode the SPARQL query
            import urllib.parse
            encoded_query = urllib.parse.quote(sparql_query)
            graphdb_query_url = f"{self._graphdb_client.base_url}/repositories/{self._graphdb_client.repository}?query={encoded_query}"
            
            # Create the SPARQL INSERT query (store only the URL)
            insert_query = f"""
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            
            INSERT DATA {{
              GRAPH <http://intent-reports-metadata> {{
                <http://5g4data.eu/5g4data#{metric_name}>
                  data5g:hasQuery <{graphdb_query_url}> .
              }}
            }}
            """
            
            headers = {
                "Content-Type": "application/sparql-update"
            }
            
            self._logger.info("Storing GraphDB query metadata for metric %s", metric_name)
            self._logger.debug("SPARQL INSERT query: %s", insert_query)
            self._logger.debug("GraphDB query URL: %s", graphdb_query_url)
            
            try:
                import requests
                response = requests.post(
                    f"{self._graphdb_client.base_url}/repositories/{self._graphdb_client.repository}/statements",
                    data=insert_query.encode("utf-8"),
                    headers=headers,
                    timeout=30
                )
                
                if response.status_code == 204:
                    self._logger.info(
                        "Successfully stored GraphDB query metadata for metric %s",
                        metric_name
                    )
                else:
                    self._logger.warning(
                        "Failed to store GraphDB query metadata for metric %s: HTTP %d - %s",
                        metric_name,
                        response.status_code,
                        response.text[:200]
                    )
            except Exception as exc:
                self._logger.warning(
                    "Error storing GraphDB query metadata for metric %s: %s",
                    metric_name,
                    exc
                )
                
        except Exception as exc:
            self._logger.warning(
                "Error creating GraphDB query metadata for metric %s: %s",
                metric_name,
                exc
            )
            # Remove from stored set so it can be retried
            with self._metadata_lock:
                self._metadata_stored.discard(metric_name)

    def _store_observation_in_graphdb(self, turtle_data: str) -> bool:
        """
        Store an observation report in GraphDB.
        
        Args:
            turtle_data: Turtle format observation report
            
        Returns:
            True if stored successfully, False otherwise
        """
        if not self._graphdb_client:
            return False
        
        try:
            # Log the Turtle data being sent to GraphDB
            self._logger.info("Storing observation report in GraphDB (Turtle format):")
            self._logger.info("=" * 70)
            for line in turtle_data.split('\n'):
                self._logger.info("  %s", line)
            self._logger.info("=" * 70)
            
            return self._graphdb_client.store_intent_report(turtle_data)
        except Exception as exc:
            self._logger.warning("Failed to store observation in GraphDB: %s", exc)
            return False

    def _report_observations_loop(
        self,
        intent_id: str,
        kpi_profile: Dict,
        condition_id: str,
        turtle_data: str,
        namespace: str,
        frequency: int
    ) -> None:
        """
        Main loop for reporting observations for a KPIProfile.
        
        This runs in a separate thread and continuously queries Prometheus
        and stores observation reports.
        
        Args:
            intent_id: TMF Intent ID
            kpi_profile: KPIProfile dictionary
            condition_id: TMF Intent condition ID
            turtle_data: TMF Intent Turtle RDF data
            namespace: Kubernetes namespace
            frequency: Reporting frequency in seconds
        """
        kpi_name = kpi_profile.get("name", "unknown")
        query = kpi_profile.get("query", "")
        endpoint = kpi_profile.get("endpoint", "")
        
        if not query:
            self._logger.error("KPIProfile %s has no query, stopping reporting", kpi_name)
            return
        
        if not endpoint:
            self._logger.warning(
                "KPIProfile %s has no endpoint, will try Kubernetes service URLs",
                kpi_name
            )
        
        # Extract objective name for unit determination
        objective_name = self._extract_objective_name_from_condition(condition_id, turtle_data)
        
        # Determine unit (respecting conversions: if ms was converted to seconds, use "s")
        unit = self._determine_unit(kpi_profile, turtle_data, condition_id, objective_name)
        
        self._logger.info(
            "Starting observation reporting loop for intent_id=%s, KPIProfile=%s, frequency=%ds",
            intent_id,
            kpi_name,
            frequency
        )
        
        # Check if thread should continue running
        def should_continue() -> bool:
            with self._thread_lock:
                if intent_id not in self._active_threads:
                    return False
                if kpi_name not in self._active_threads[intent_id]:
                    return False
                return self._active_threads[intent_id][kpi_name].get("running", False)
        
        while should_continue():
            try:
                # Query Prometheus
                query_result = self._query_prometheus(query, endpoint, namespace)
                
                if query_result.get("success"):
                    if query_result.get("value") is not None:
                        metric_value = query_result["value"]
                        
                        # Get timestamp
                        if query_result.get("timestamp"):
                            timestamp = datetime.fromtimestamp(
                                float(query_result["timestamp"]),
                                tz=timezone.utc
                            )
                        else:
                            timestamp = datetime.now(timezone.utc)
                        
                        # Generate observation report
                        observation_turtle = self._generate_observation_turtle(
                            intent_id=intent_id,
                            condition_id=condition_id,
                            metric_value=metric_value,
                            timestamp=timestamp,
                            turtle_data=turtle_data,
                            unit=unit
                        )
                        
                        # Store in GraphDB
                        if self._store_observation_in_graphdb(observation_turtle):
                            self._logger.debug(
                                "Stored observation for intent_id=%s, KPIProfile=%s, value=%.3f %s",
                                intent_id,
                                kpi_name,
                                metric_value,
                                unit
                            )
                        else:
                            self._logger.warning(
                                "Failed to store observation for intent_id=%s, KPIProfile=%s",
                                intent_id,
                                kpi_name
                            )
                    else:
                        # No results - metric not available yet
                        self._logger.debug(
                            "No metric value available for intent_id=%s, KPIProfile=%s: %s",
                            intent_id,
                            kpi_name,
                            query_result.get("message", "No results")
                        )
                else:
                    # Query failed
                    self._logger.warning(
                        "Prometheus query failed for intent_id=%s, KPIProfile=%s: %s",
                        intent_id,
                        kpi_name,
                        query_result.get("error", "Unknown error")
                    )
                
            except Exception as exc:
                self._logger.error(
                    "Error in observation reporting loop for intent_id=%s, KPIProfile=%s: %s",
                    intent_id,
                    kpi_name,
                    exc,
                    exc_info=True
                )
            
            # Wait before next query
            time.sleep(frequency)
        
        self._logger.info(
            "Stopped observation reporting loop for intent_id=%s, KPIProfile=%s",
            intent_id,
            kpi_name
        )
