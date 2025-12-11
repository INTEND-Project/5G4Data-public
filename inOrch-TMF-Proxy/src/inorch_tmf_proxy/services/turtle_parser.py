from __future__ import annotations

import logging
from typing import Optional, Tuple, Dict, Any
from rdflib import Graph, URIRef, Literal
from rdflib.namespace import RDF


class TurtleParser:
    """Parser for Turtle RDF expressions to extract deployment-related information."""

    # RDF namespaces
    DATA5G_NS = "http://5g4data.eu/5g4data#"
    ICM_NS = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/"

    def __init__(self):
        self._logger = logging.getLogger(self.__class__.__name__)

    def parse_deployment_info(self, turtle_data: str) -> Optional[dict]:
        """
        Parse Turtle RDF data to extract deployment information.

        Returns a dictionary with:
        - 'deployment_descriptor': Helm chart URL from data5g:DeploymentDescriptor
        - 'application': Application name from data5g:Application (used as namespace)
        - 'has_deployment_expectation': Boolean indicating if DeploymentExpectation exists

        Returns None if no deployment information is found.
        """
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            
            # Bind namespaces for easier querying (if not already bound)
            graph.bind("data5g", self.DATA5G_NS, override=False)
            
            # Check for DeploymentExpectation
            deployment_expectation = self._find_deployment_expectation(graph)
            if not deployment_expectation:
                self._logger.debug("No DeploymentExpectation found in Turtle data")
                return None

            # Find the Context referenced by the DeploymentExpectation
            context = self._find_context_for_expectation(graph, deployment_expectation)
            if not context:
                self._logger.warning("DeploymentExpectation found but no associated Context")
                return None

            # Extract DeploymentDescriptor and Application from Context
            deployment_descriptor = self._extract_property(graph, context, "DeploymentDescriptor")
            application = self._extract_property(graph, context, "Application")

            if not deployment_descriptor:
                self._logger.warning("Context found but no DeploymentDescriptor")
                return None

            if not application:
                self._logger.warning("Context found but no Application name")
                return None

            result = {
                "deployment_descriptor": deployment_descriptor,
                "application": application,
                "has_deployment_expectation": True,
            }

            self._logger.info(
                "Extracted deployment info: app=%s, chart=%s",
                application,
                deployment_descriptor,
            )
            return result

        except Exception as exc:
            self._logger.error("Failed to parse Turtle RDF data: %s", exc, exc_info=True)
            return None

    def _find_deployment_expectation(self, graph: Graph) -> Optional[URIRef]:
        """Find the DeploymentExpectation node in the graph."""
        data5g_deployment_expectation = URIRef(f"{self.DATA5G_NS}DeploymentExpectation")
        
        # Query for subjects that are of type DeploymentExpectation
        for subject in graph.subjects(RDF.type, data5g_deployment_expectation):
            self._logger.debug("Found DeploymentExpectation: %s", subject)
            return subject
        
        return None

    def _find_context_for_expectation(
        self, graph: Graph, expectation: URIRef
    ) -> Optional[URIRef]:
        """
        Find the Context associated with the DeploymentExpectation.
        
        The Context is typically referenced via log:allOf in the expectation.
        """
        # The expectation references the context via log:allOf
        # We need to find a Context that is referenced by the expectation
        log_allof = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/allOf")
        icm_context = URIRef(f"{self.ICM_NS}Context")
        data5g_deployment_descriptor = URIRef(f"{self.DATA5G_NS}DeploymentDescriptor")

        # Find all objects referenced by the expectation via log:allOf
        referenced_objects = list(graph.objects(expectation, log_allof))
        
        # Check each referenced object to see if it's a Context with DeploymentDescriptor
        for obj in referenced_objects:
            # Check if this object is a Context
            if (obj, RDF.type, icm_context) in graph:
                # Check if it has a DeploymentDescriptor
                if (obj, data5g_deployment_descriptor, None) in graph:
                    self._logger.debug("Found Context with DeploymentDescriptor: %s", obj)
                    return obj
        
        return None

    def _extract_property(
        self, graph: Graph, subject: URIRef, property_name: str
    ) -> Optional[str]:
        """Extract a property value from the graph for the given subject."""
        property_uri = URIRef(f"{self.DATA5G_NS}{property_name}")
        
        # Get the object value
        for obj in graph.objects(subject, property_uri):
            if isinstance(obj, Literal):
                return str(obj)
            elif isinstance(obj, URIRef):
                return str(obj)
        
        return None

    def parse_p99_token_target(self, turtle_data: str) -> Optional[float]:
        """
        Parse Turtle RDF data to extract p99-token-target value from Condition.
        
        Looks for conditions with data5g:p99-token-target as the target property
        and extracts the value from quan:smaller constraint.
        
        Returns the value in seconds (converts from ms if needed), or None if not found.
        """
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            graph.bind("data5g", self.DATA5G_NS, override=False)
            graph.bind("icm", self.ICM_NS, override=False)
            graph.bind("quan", "http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/", override=False)
            graph.bind("set", "http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/", override=False)
            
            icm_condition = URIRef(f"{self.ICM_NS}Condition")
            set_forall = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/forAll")
            icm_values_of_target_prop = URIRef(f"{self.ICM_NS}valuesOfTargetProperty")
            quan_smaller = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/smaller")
            quan_unit = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/unit")
            rdf_value = URIRef("http://www.w3.org/1999/02/22-rdf-syntax-ns#value")
            
            # Find all Conditions
            for condition in graph.subjects(RDF.type, icm_condition):
                # Check if this condition has a forAll that references p99-token-target
                forall_objects = list(graph.objects(condition, set_forall))
                
                for forall_obj in forall_objects:
                    # Check if this forAll has valuesOfTargetProperty pointing to p99-token-target
                    target_props = list(graph.objects(forall_obj, icm_values_of_target_prop))
                    
                    for target_prop in target_props:
                        target_prop_str = str(target_prop)
                        # Check if it contains p99-token-target
                        if "p99-token-target" in target_prop_str:
                            self._logger.debug(
                                "Found p99-token-target condition: %s",
                                target_prop_str
                            )
                            
                            # Find the quan:smaller constraint
                            smaller_objects = list(graph.objects(forall_obj, quan_smaller))
                            
                            for smaller_obj in smaller_objects:
                                # Extract the value and unit
                                value = None
                                unit = None
                                
                                # Get the value
                                for val_obj in graph.objects(smaller_obj, rdf_value):
                                    if isinstance(val_obj, Literal):
                                        try:
                                            value = float(val_obj)
                                        except (ValueError, TypeError):
                                            continue
                                
                                # Get the unit
                                for unit_obj in graph.objects(smaller_obj, quan_unit):
                                    if isinstance(unit_obj, Literal):
                                        unit = str(unit_obj).lower()
                                
                                if value is not None:
                                    # Convert to seconds if unit is ms
                                    if unit == "ms":
                                        value_seconds = value / 1000.0
                                    elif unit == "s" or unit == "sec" or unit == "seconds":
                                        value_seconds = value
                                    else:
                                        # Default to seconds if unit is unknown
                                        value_seconds = value
                                        self._logger.warning(
                                            "Unknown unit '%s' for p99-token-target, assuming seconds",
                                            unit
                                        )
                                    
                                    self._logger.info(
                                        "Extracted p99-token-target: %.3f %s (%.3f seconds)",
                                        value,
                                        unit or "unknown",
                                        value_seconds
                                    )
                                    return value_seconds
            
            return None
        except Exception as exc:
            self._logger.warning("Failed to extract p99-token-target from Turtle: %s", exc)
            return None

    def _extract_objective_name(self, property_uri: URIRef) -> Optional[str]:
        """
        Extract the local name from a property URI.
        
        Example: http://5g4data.eu/5g4data#p99-token-target -> p99-token-target
        """
        uri_str = str(property_uri)
        
        # Try to extract from data5g namespace
        if uri_str.startswith(self.DATA5G_NS):
            return uri_str[len(self.DATA5G_NS):]
        
        # Try to extract from hash fragment
        if "#" in uri_str:
            return uri_str.split("#")[-1]
        
        # Try to extract from last slash
        if "/" in uri_str:
            return uri_str.split("/")[-1]
        
        return None

    def parse_deployment_expectation_objectives(self, turtle_data: str) -> Dict[str, Dict[str, Any]]:
        """
        Parse TMF Intent and extract all objective names and values from DeploymentExpectation conditions.
        
        This method finds all Conditions linked to DeploymentExpectation via log:allOf,
        extracts objective names from valuesOfTargetProperty, and extracts values from
        quan:smaller/quan:unit/rdf:value constraints.
        
        Returns a dictionary mapping objective names to their values:
        {
            "p99-token-target": {
                "value": 0.4,  # in seconds
                "unit": "ms",  # original unit
                "original_value": 400  # original value before conversion
            },
            "p95-token-target": {
                "value": 0.8,
                "unit": "ms",
                "original_value": 800
            }
        }
        
        Returns empty dict if no objectives found or on error.
        """
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            
            # Bind namespaces
            graph.bind("data5g", self.DATA5G_NS, override=False)
            graph.bind("icm", self.ICM_NS, override=False)
            graph.bind("log", "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/", override=False)
            graph.bind("set", "http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/", override=False)
            graph.bind("quan", "http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/", override=False)
            
            # URIRefs for querying
            data5g_deployment_expectation = URIRef(f"{self.DATA5G_NS}DeploymentExpectation")
            icm_condition = URIRef(f"{self.ICM_NS}Condition")
            log_allof = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/allOf")
            set_forall = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/forAll")
            icm_values_of_target_prop = URIRef(f"{self.ICM_NS}valuesOfTargetProperty")
            quan_smaller = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/smaller")
            quan_unit = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/unit")
            rdf_value = URIRef("http://www.w3.org/1999/02/22-rdf-syntax-ns#value")
            
            # Find DeploymentExpectation
            deployment_expectation = self._find_deployment_expectation(graph)
            if not deployment_expectation:
                self._logger.debug("No DeploymentExpectation found in Turtle data")
                return {}
            
            # Find Conditions linked to DeploymentExpectation via log:allOf
            conditions = []
            for obj in graph.objects(deployment_expectation, log_allof):
                # Check if this object is a Condition
                if (obj, RDF.type, icm_condition) in graph:
                    conditions.append(obj)
                    self._logger.debug(f"Found Condition linked to DeploymentExpectation: {obj}")
            
            if not conditions:
                self._logger.debug("No Conditions found in DeploymentExpectation")
                return {}
            
            # Extract objectives from each Condition
            objectives = {}
            
            for condition in conditions:
                self._logger.debug(f"Processing Condition: {condition}")
                
                # Find forAll objects in this condition
                forall_objects = list(graph.objects(condition, set_forall))
                
                for forall_obj in forall_objects:
                    self._logger.debug(f"  Found forAll object: {forall_obj}")
                    
                    # Extract valuesOfTargetProperty
                    target_props = list(graph.objects(forall_obj, icm_values_of_target_prop))
                    
                    for target_prop in target_props:
                        # Extract objective name
                        objective_name = self._extract_objective_name(target_prop)
                        if not objective_name:
                            self._logger.warning(f"Could not extract name from property: {target_prop}")
                            continue
                        
                        self._logger.debug(f"  Found objective: {objective_name}")
                        
                        # Find quan:smaller constraint
                        smaller_objects = list(graph.objects(forall_obj, quan_smaller))
                        
                        for smaller_obj in smaller_objects:
                            # Extract value and unit
                            value = None
                            unit = None
                            
                            # Get the value
                            for val_obj in graph.objects(smaller_obj, rdf_value):
                                if isinstance(val_obj, Literal):
                                    try:
                                        value = float(val_obj)
                                    except (ValueError, TypeError):
                                        continue
                            
                            # Get the unit
                            for unit_obj in graph.objects(smaller_obj, quan_unit):
                                if isinstance(unit_obj, Literal):
                                    unit = str(unit_obj).lower()
                            
                            if value is not None:
                                # Convert to seconds if unit is ms
                                original_value = value
                                if unit == "ms":
                                    value_seconds = value / 1000.0
                                elif unit == "s" or unit == "sec" or unit == "seconds":
                                    value_seconds = value
                                else:
                                    # Default to seconds if unit is unknown
                                    value_seconds = value
                                    self._logger.warning(
                                        f"Unknown unit '{unit}' for {objective_name}, assuming seconds"
                                    )
                                
                                objectives[objective_name] = {
                                    "value": value_seconds,
                                    "unit": unit or "unknown",
                                    "original_value": original_value
                                }
                                
                                self._logger.info(
                                    f"Extracted {objective_name}: {original_value} {unit or 'unknown'} "
                                    f"({value_seconds} seconds)"
                                )
            
            return objectives
            
        except Exception as exc:
            self._logger.warning("Failed to extract objectives from DeploymentExpectation: %s", exc)
            return {}

