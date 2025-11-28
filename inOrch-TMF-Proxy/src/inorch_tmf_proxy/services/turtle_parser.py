from __future__ import annotations

import logging
from typing import Optional, Tuple
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

