from __future__ import annotations

import logging
from typing import Optional, List, Tuple
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

    def find_network_expectation(self, turtle_data: str) -> Optional[URIRef]:
        """Find the NetworkExpectation node in the Turtle data."""
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            graph.bind("data5g", self.DATA5G_NS, override=False)
            
            data5g_network_expectation = URIRef(f"{self.DATA5G_NS}NetworkExpectation")
            
            # Query for subjects that are of type NetworkExpectation
            for subject in graph.subjects(RDF.type, data5g_network_expectation):
                self._logger.debug("Found NetworkExpectation: %s", subject)
                return subject
            
            return None
        except Exception as exc:
            self._logger.error("Failed to find NetworkExpectation: %s", exc, exc_info=True)
            return None

    def find_deployment_expectation(self, turtle_data: str) -> Optional[URIRef]:
        """Find the DeploymentExpectation node in the Turtle data."""
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            graph.bind("data5g", self.DATA5G_NS, override=False)
            
            return self._find_deployment_expectation(graph)
        except Exception as exc:
            self._logger.error("Failed to find DeploymentExpectation: %s", exc, exc_info=True)
            return None

    def find_requirement_expectations(self, turtle_data: str) -> List[URIRef]:
        """Find all ReportingExpectation nodes in the Turtle data."""
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            graph.bind("data5g", self.DATA5G_NS, override=False)
            graph.bind("icm", self.ICM_NS, override=False)
            
            # REs use icm:ReportingExpectation, not data5g:RequirementExpectation
            icm_reporting_expectation = URIRef(f"{self.ICM_NS}ReportingExpectation")
            
            # Query for all subjects that are of type ReportingExpectation
            requirements = list(graph.subjects(RDF.type, icm_reporting_expectation))
            
            if requirements:
                self._logger.debug("Found %d ReportingExpectation(s)", len(requirements))
            
            return requirements
        except Exception as exc:
            self._logger.error("Failed to find ReportingExpectations: %s", exc, exc_info=True)
            return []

    def find_all_expectations(self, turtle_data: str) -> Tuple[Optional[URIRef], Optional[URIRef], List[URIRef]]:
        """
        Find all expectation types in the Turtle data.
        
        Returns:
            Tuple of (NetworkExpectation, DeploymentExpectation, List[RequirementExpectation])
        """
        ne = self.find_network_expectation(turtle_data)
        de = self.find_deployment_expectation(turtle_data)
        re_list = self.find_requirement_expectations(turtle_data)
        
        return (ne, de, re_list)

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

    def parse_datacenter(self, turtle_data: str) -> Optional[str]:
        """
        Parse Turtle RDF data to extract DataCenter from Context.
        
        Looks for Context nodes that contain data5g:DataCenter property.
        
        Returns the DataCenter identifier (e.g., "EC21", "EC1"), or None if not found.
        """
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            graph.bind("data5g", self.DATA5G_NS, override=False)
            graph.bind("icm", self.ICM_NS, override=False)
            
            icm_context = URIRef(f"{self.ICM_NS}Context")
            data5g_datacenter = URIRef(f"{self.DATA5G_NS}DataCenter")
            
            # Find all Context nodes
            for context in graph.subjects(RDF.type, icm_context):
                # Check if this context has a DataCenter property
                for datacenter_obj in graph.objects(context, data5g_datacenter):
                    if isinstance(datacenter_obj, Literal):
                        datacenter = str(datacenter_obj)
                        self._logger.debug("Extracted DataCenter: %s", datacenter)
                        return datacenter
                    elif isinstance(datacenter_obj, URIRef):
                        datacenter = str(datacenter_obj)
                        self._logger.debug("Extracted DataCenter: %s", datacenter)
                        return datacenter
            
            self._logger.debug("No DataCenter found in Turtle data")
            return None
            
        except Exception as exc:
            self._logger.error("Failed to extract DataCenter from Turtle: %s", exc, exc_info=True)
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

    def split_turtle_intent(
        self, turtle_data: str
    ) -> Tuple[str, str]:
        """
        Split a Turtle intent expression into two parts: one for NetworkExpectation and one for DeploymentExpectation.
        
        Args:
            turtle_data: The full Turtle expression containing both NE and DE
            
        Returns:
            Tuple of (ne_turtle, de_turtle) - two separate Turtle expressions
            
        Raises:
            ValueError: If the intent cannot be split (missing expectations, etc.)
        """
        try:
            graph = Graph()
            graph.parse(data=turtle_data, format="turtle")
            graph.bind("data5g", self.DATA5G_NS, override=False)
            graph.bind("icm", self.ICM_NS, override=False)
            graph.bind("log", "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/", override=False)
            
            # Find all expectations - but we need to use URIRefs from the parsed graph, not from re-parsing
            # So find them directly in the graph we just parsed
            data5g_network_expectation = URIRef(f"{self.DATA5G_NS}NetworkExpectation")
            data5g_deployment_expectation = URIRef(f"{self.DATA5G_NS}DeploymentExpectation")
            # REs use icm:ReportingExpectation, not data5g:RequirementExpectation
            icm_reporting_expectation = URIRef(f"{self.ICM_NS}ReportingExpectation")
            
            # Find expectations in the parsed graph
            ne = None
            for subject in graph.subjects(RDF.type, data5g_network_expectation):
                ne = subject
                break
            
            de = None
            for subject in graph.subjects(RDF.type, data5g_deployment_expectation):
                de = subject
                break
            
            re_list = []
            for subject in graph.subjects(RDF.type, icm_reporting_expectation):
                re_list.append(subject)
            
            self._logger.debug(
                "Found expectations: NE=%s, DE=%s, REs=%d: %s",
                ne,
                de,
                len(re_list),
                [str(re) for re in re_list]
            )
            
            if not ne or not de:
                raise ValueError("Cannot split intent: both NetworkExpectation and DeploymentExpectation must be present")
            
            # Find the Intent node
            icm_intent = URIRef(f"{self.ICM_NS}Intent")
            icm_intent_element = URIRef(f"{self.ICM_NS}IntentElement")
            intent_node = None
            
            # Find the Intent node (subject that is both Intent and IntentElement)
            for subject in graph.subjects(RDF.type, icm_intent):
                if (subject, RDF.type, icm_intent_element) in graph:
                    intent_node = subject
                    break
            
            if not intent_node:
                raise ValueError("Cannot split intent: Intent node not found")
            
            # Generate new intent IDs for NE and DE versions
            # Extract original ID from intent_node URI (e.g., "http://5g4data.eu/5g4data#I<uuid>" -> "<uuid>")
            original_uri = str(intent_node)
            # Create new URIs with suffixes
            ne_intent_node = URIRef(f"{original_uri}-ne")
            de_intent_node = URIRef(f"{original_uri}-de")
            
            self._logger.debug(
                "Creating new intent IDs: NE=%s, DE=%s (original=%s)",
                ne_intent_node,
                de_intent_node,
                intent_node
            )
            
            # Get log:allOf property from intent
            log_allof = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/allOf")
            
            # Helper function to collect all entities referenced transitively via log:allOf and properties
            def collect_referenced_entities(start_entity: URIRef, visited: set = None) -> set:
                """Recursively collect all entities referenced via log:allOf and other properties."""
                if visited is None:
                    visited = set()
                if start_entity in visited:
                    return visited
                visited.add(start_entity)
                
                # Get all entities referenced via log:allOf
                for referenced in graph.objects(start_entity, log_allof):
                    if isinstance(referenced, URIRef):
                        collect_referenced_entities(referenced, visited)
                
                # Also collect entities referenced via other properties (like data5g:appliesToRegion)
                # This ensures we get geo:Feature and other related entities
                # Get all triples where start_entity is subject
                for _, predicate, obj in graph.triples((start_entity, None, None)):
                    if isinstance(obj, URIRef) and obj not in visited:
                        # Check if it's a reference to another entity (appears as subject in graph)
                        # This catches properties like appliesToRegion -> geo:Feature
                        # We check if it has at least one triple as subject, meaning it's an entity
                        for _ in graph.triples((obj, None, None)):
                            collect_referenced_entities(obj, visited)
                            break
                
                return visited
            
            # Collect entities for NE: NE itself + all entities it references + all REs + entities REs reference
            # Start with empty set, collect recursively, then add core entities
            ne_entities = collect_referenced_entities(ne, set())
            # Add all REs and collect their references (REs might not have log:allOf, so we add them explicitly)
            for re_entity in re_list:
                ne_entities.add(re_entity)
                # Collect any entities the RE references
                collect_referenced_entities(re_entity, ne_entities)
            # Ensure core entities are included
            ne_entities.add(ne)
            ne_entities.add(intent_node)  # Include original for triple collection
            
            # Collect entities for DE: DE itself + all entities it references + all REs + entities REs reference
            # Start with empty set, collect recursively, then add core entities
            de_entities = collect_referenced_entities(de, set())
            # Add all REs and collect their references (REs might not have log:allOf, so we add them explicitly)
            for re_entity in re_list:
                de_entities.add(re_entity)
                # Collect any entities the RE references
                collect_referenced_entities(re_entity, de_entities)
            # Ensure core entities are included
            de_entities.add(de)
            de_entities.add(intent_node)  # Include original for triple collection
            
            self._logger.debug(
                "Found %d REs: %s",
                len(re_list),
                [str(re) for re in re_list]
            )
            
            self._logger.debug(
                "Entity collection: NE entities=%d (including %d REs), DE entities=%d (including %d REs)",
                len(ne_entities),
                len(re_list),
                len(de_entities),
                len(re_list)
            )
            if self._logger.isEnabledFor(logging.DEBUG):
                self._logger.debug("NE entities: %s", [str(e) for e in sorted(ne_entities, key=str)])
                self._logger.debug("DE entities: %s", [str(e) for e in sorted(de_entities, key=str)])
            
            # Helper function to collect all blank nodes connected to entities in the set
            def collect_connected_blank_nodes(entity_set: set) -> set:
                """Collect all blank nodes that are connected to entities in the set."""
                from rdflib import BNode
                blank_nodes = set()
                to_check = list(entity_set)
                checked_entities = set()
                checked_blanks = set()
                
                while to_check:
                    entity = to_check.pop()
                    if entity in checked_entities:
                        continue
                    checked_entities.add(entity)
                    
                    # Get all triples where entity is subject
                    for triple in graph.triples((entity, None, None)):
                        _, _, obj = triple
                        # If object is a blank node, add it and traverse it
                        if isinstance(obj, BNode) and obj not in checked_blanks:
                            blank_nodes.add(obj)
                            checked_blanks.add(obj)
                            to_check.append(obj)
                    
                    # Get all triples where entity is object
                    for triple in graph.triples((None, None, entity)):
                        subject, _, _ = triple
                        # If subject is a blank node, add it and traverse it
                        if isinstance(subject, BNode) and subject not in checked_blanks:
                            blank_nodes.add(subject)
                            checked_blanks.add(subject)
                            to_check.append(subject)
                    
                    # Also check if entity itself is a blank node (shouldn't happen, but be safe)
                    if isinstance(entity, BNode):
                        blank_nodes.add(entity)
                
                return blank_nodes
            
            # Collect blank nodes for each entity set
            ne_blank_nodes = collect_connected_blank_nodes(ne_entities)
            de_blank_nodes = collect_connected_blank_nodes(de_entities)
            
            # Helper function to check if a triple should be included (involves any of the entities or blank nodes)
            def should_include_triple(triple, entity_set: set, blank_node_set: set) -> bool:
                """Check if a triple involves any entity or blank node in the sets."""
                from rdflib import BNode
                subject, predicate, obj = triple
                # Include if subject is in entity set
                if isinstance(subject, URIRef) and subject in entity_set:
                    return True
                # Include if subject is a blank node in blank node set
                if isinstance(subject, BNode) and subject in blank_node_set:
                    return True
                # Include if object is a URIRef in entity set
                if isinstance(obj, URIRef) and obj in entity_set:
                    return True
                # Include if object is a blank node in blank node set
                if isinstance(obj, BNode) and obj in blank_node_set:
                    return True
                return False
            
            # Create graphs for NE and DE versions
            ne_graph = Graph()
            de_graph = Graph()
            
            # Copy all namespace bindings (ensure all prefixes are included)
            # Also explicitly bind common prefixes that might be missing
            common_prefixes = {
                "data5g": "http://5g4data.eu/5g4data#",
                "dct": "http://purl.org/dc/terms/",
                "dcterms": "http://purl.org/dc/terms/",
                "icm": "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/",
                "imo": "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/",
                "log": "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/",
                "quan": "http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/",
                "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
                "set": "http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/",
                "xsd": "http://www.w3.org/2001/XMLSchema#",
                "geo": "http://www.opengis.net/ont/geosparql#",
            }
            
            for prefix, namespace in graph.namespaces():
                ne_graph.bind(prefix, namespace, override=False)
                de_graph.bind(prefix, namespace, override=False)
            
            # Also bind common prefixes explicitly to ensure they're included
            for prefix, namespace in common_prefixes.items():
                ne_graph.bind(prefix, namespace, override=False)
                de_graph.bind(prefix, namespace, override=False)
            
            # Add only relevant triples to each graph
            # First, collect all triples that should be included
            ne_triples_to_add = set()
            de_triples_to_add = set()
            
            for triple in graph:
                subject, predicate, obj = triple
                
                # Skip namespace/prefix triples (they're handled by bind)
                if predicate == URIRef("http://www.w3.org/1999/02/22-rdf-syntax-ns#type") and str(obj) == "http://www.w3.org/2002/07/owl#Ontology":
                    continue
                
                # For NE graph: include if involves NE entities or connected blank nodes
                if should_include_triple(triple, ne_entities, ne_blank_nodes):
                    ne_triples_to_add.add(triple)
                
                # For DE graph: include if involves DE entities or connected blank nodes
                if should_include_triple(triple, de_entities, de_blank_nodes):
                    de_triples_to_add.add(triple)
            
            # Helper function to replace intent node in a triple
            def replace_intent_node(triple, old_node: URIRef, new_node: URIRef):
                """Replace old_node with new_node in a triple."""
                subject, predicate, obj = triple
                new_subject = new_node if subject == old_node else subject
                new_obj = new_node if obj == old_node else obj
                return (new_subject, predicate, new_obj)
            
            # Add all collected triples, replacing the original intent_node with new ones
            for triple in ne_triples_to_add:
                new_triple = replace_intent_node(triple, intent_node, ne_intent_node)
                ne_graph.add(new_triple)
            for triple in de_triples_to_add:
                new_triple = replace_intent_node(triple, intent_node, de_intent_node)
                de_graph.add(new_triple)
            
            # Verify RE triples are included
            for re_entity in re_list:
                re_triples_ne = [t for t in ne_triples_to_add if t[0] == re_entity]
                re_triples_de = [t for t in de_triples_to_add if t[0] == re_entity]
                self._logger.debug(
                    "RE %s: NE has %d triples, DE has %d triples",
                    re_entity,
                    len(re_triples_ne),
                    len(re_triples_de)
                )
            
            self._logger.debug(
                "Triple collection: NE=%d triples (entities=%d, blanks=%d), DE=%d triples (entities=%d, blanks=%d)",
                len(ne_triples_to_add),
                len(ne_entities),
                len(ne_blank_nodes),
                len(de_triples_to_add),
                len(de_entities),
                len(de_blank_nodes)
            )
            
            # Update Intent node properties for NE version (using new ne_intent_node)
            imo_handler = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/handler")
            imo_owner = URIRef("http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/owner")
            data5g_derived_from = URIRef(f"{self.DATA5G_NS}derivedFrom")
            
            # Remove old handler and owner (from new intent node, which was copied from original)
            ne_graph.remove((ne_intent_node, imo_handler, None))
            ne_graph.remove((ne_intent_node, imo_owner, None))
            # Set handler to "inNet" and owner to "inServ"
            ne_graph.add((ne_intent_node, imo_handler, Literal("inNet")))
            ne_graph.add((ne_intent_node, imo_owner, Literal("inServ")))
            # Add provenance link to original combined intent
            ne_graph.add((ne_intent_node, data5g_derived_from, intent_node))
            
            # Update Intent node properties for DE version (using new de_intent_node)
            # Remove old handler and owner (from new intent node, which was copied from original)
            de_graph.remove((de_intent_node, imo_handler, None))
            de_graph.remove((de_intent_node, imo_owner, None))
            # Set handler to "inOrch" and owner to "inServ"
            de_graph.add((de_intent_node, imo_handler, Literal("inOrch")))
            de_graph.add((de_intent_node, imo_owner, Literal("inServ")))
            # Add provenance link to original combined intent
            de_graph.add((de_intent_node, data5g_derived_from, intent_node))
            
            # Update log:allOf for NE version: include NE + all REs (using new ne_intent_node)
            ne_allof = [ne] + re_list
            self._logger.debug(
                "NE log:allOf will include: NE=%s, REs=%s (total %d items)",
                ne,
                [str(re) for re in re_list],
                len(ne_allof)
            )
            # Remove old log:allOf from intent in NE graph (from new intent node)
            ne_graph.remove((ne_intent_node, log_allof, None))
            # Add new log:allOf with NE and REs
            for obj in ne_allof:
                ne_graph.add((ne_intent_node, log_allof, obj))
            
            # Verify REs were added to log:allOf
            ne_allof_actual = list(ne_graph.objects(ne_intent_node, log_allof))
            self._logger.debug(
                "NE log:allOf after update: %s",
                [str(obj) for obj in ne_allof_actual]
            )
            
            # Update log:allOf for DE version: include DE + all REs (using new de_intent_node)
            de_allof = [de] + re_list
            self._logger.debug(
                "DE log:allOf will include: DE=%s, REs=%s (total %d items)",
                de,
                [str(re) for re in re_list],
                len(de_allof)
            )
            # Remove old log:allOf from intent in DE graph (from new intent node)
            de_graph.remove((de_intent_node, log_allof, None))
            # Add new log:allOf with DE and REs
            for obj in de_allof:
                de_graph.add((de_intent_node, log_allof, obj))
            
            # Verify REs were added to log:allOf
            de_allof_actual = list(de_graph.objects(de_intent_node, log_allof))
            self._logger.debug(
                "DE log:allOf after update: %s",
                [str(obj) for obj in de_allof_actual]
            )
            
            # Serialize to Turtle format
            ne_serialized = ne_graph.serialize(format="turtle")
            de_serialized = de_graph.serialize(format="turtle")
            ne_turtle = ne_serialized.decode("utf-8") if isinstance(ne_serialized, bytes) else ne_serialized
            de_turtle = de_serialized.decode("utf-8") if isinstance(de_serialized, bytes) else de_serialized
            
            self._logger.info(
                "Parsing: Split intent into NE version (%d triples, ID: %s) and DE version (%d triples, ID: %s)",
                len(ne_graph),
                ne_intent_node,
                len(de_graph),
                de_intent_node
            )
            
            return (ne_turtle, de_turtle)
            
        except Exception as exc:
            self._logger.error("Failed to split Turtle intent: %s", exc, exc_info=True)
            raise ValueError(f"Cannot split intent: {str(exc)}") from exc
