"""Core intent generation functionality."""

import uuid
import time
from typing import List, Union, Dict, Any
from rdflib import Graph, Namespace, RDF, Literal, XSD, URIRef, BNode
from rdflib.collection import Collection
from rdflib.namespace import RDFS

from .models import NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams, IntentType
from .utils import get_polygon_from_location, get_default_polygon, get_operator_mapping


class IntentGenerator:
    """Generator for TM Forum formatted intents."""
    
    def __init__(self):
        """Initialize the intent generator with required namespaces."""
        # Define all required namespaces
        self.icm = Namespace("http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/")
        self.dct = Namespace("http://purl.org/dc/terms/")
        self.xsd = Namespace("http://www.w3.org/2001/XMLSchema#")
        self.rdf = Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#")
        self.rdfs = Namespace("http://www.w3.org/2000/01/rdf-schema#")
        self.log = Namespace("http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/")
        self.set = Namespace("http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/")
        self.quan = Namespace("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/")
        self.geo = Namespace("http://www.opengis.net/ont/geosparql#")
        self.data = Namespace("http://5g4data.eu/5g4data#")
        self.imo = Namespace("http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/")
        
        # Get operator mapping
        self.operator_map = get_operator_mapping()

    def generate(self, intent_type: Union[str, IntentType], parameters: Union[Dict[str, Any], NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams]) -> str:
        """Generate an intent based on type and parameters.
        
        Args:
            intent_type: Type of intent to generate ("network", "workload", "combined")
            parameters: Parameters for intent generation
            
        Returns:
            Turtle-formatted intent string
            
        Raises:
            ValueError: If intent type is not supported
        """
        # Convert string to enum if needed
        if isinstance(intent_type, str):
            try:
                intent_type = IntentType(intent_type)
            except ValueError:
                raise ValueError(f"Unknown intent type: {intent_type}")
        
        # Convert dict to appropriate params object if needed
        if isinstance(parameters, dict):
            if intent_type == IntentType.NETWORK:
                parameters = NetworkIntentParams(**parameters)
            elif intent_type == IntentType.WORKLOAD:
                parameters = WorkloadIntentParams(**parameters)
            elif intent_type == IntentType.COMBINED:
                parameters = CombinedIntentParams(**parameters)
        
        # Generate based on type
        if intent_type == IntentType.NETWORK:
            return self.generate_network_intent(parameters)
        elif intent_type == IntentType.WORKLOAD:
            return self.generate_workload_intent(parameters)
        elif intent_type == IntentType.COMBINED:
            return self.generate_combined_intent(parameters)
        else:
            raise ValueError(f"Unknown intent type: {intent_type}")

    def generate_sequence(self, intent_type: Union[str, IntentType], parameters: Union[Dict[str, Any], NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams], count: int = 1, interval: float = 0) -> List[str]:
        """Generate a sequence of intents.
        
        Args:
            intent_type: Type of intent to generate
            parameters: Parameters for intent generation
            count: Number of intents to generate
            interval: Time interval between generations (seconds)
            
        Returns:
            List of turtle-formatted intent strings
        """
        intents = []
        for _ in range(count):
            intent = self.generate(intent_type, parameters)
            intents.append(intent)
            if interval > 0 and _ < count - 1:
                time.sleep(interval)
        return intents

    def generate_network_intent(self, params: NetworkIntentParams) -> str:
        """Generate a network intent."""
        g = self._create_base_graph()
        
        # Get polygon from location if provided
        if params.location and not params.polygon:
            try:
                polygon = get_polygon_from_location(params.location)
            except Exception:
                polygon = get_default_polygon()
        elif params.polygon:
            polygon = params.polygon
        else:
            polygon = get_default_polygon()

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de_id = f"NE{uuid.uuid4().hex}"
        c1_id = f"co_{uuid.uuid4().hex}"
        c2_id = f"co_{uuid.uuid4().hex}"
        cx_id = f"CX{uuid.uuid4().hex}"
        region_id = f"RG{uuid.uuid4().hex}"
        re_id = f"RE{uuid.uuid4().hex}"

        # Create intent
        intent_uri = self.data[intent_id]
        g.add((intent_uri, RDF.type, self.icm.Intent))
        g.add((intent_uri, self.log.allOf, self.data[de_id]))
        g.add((intent_uri, self.log.allOf, self.data[re_id]))

        # Add handler and owner if provided
        if params.handler:
            g.add((intent_uri, self.imo.handler, Literal(params.handler, datatype=self.xsd.string)))
        if params.owner:
            g.add((intent_uri, self.imo.owner, Literal(params.owner, datatype=self.xsd.string)))

        # Create delivery expectation
        de_uri = self.data[de_id]
        g.add((de_uri, RDF.type, self.data.NetworkExpectation))
        g.add((de_uri, self.icm.target, self.data["network-slice"]))
        g.add((de_uri, self.dct.description, Literal(params.description or "Ensure QoS guarantees for network slice")))
        g.add((de_uri, self.log.allOf, self.data[c1_id]))
        g.add((de_uri, self.log.allOf, self.data[c2_id]))
        g.add((de_uri, self.log.allOf, self.data[cx_id]))

        # Create latency condition
        c1_uri = self.data[c1_id]
        g.add((c1_uri, RDF.type, self.icm.Condition))
        description = self._create_condition_description("Latency", params.latency_operator, params.latency, params.latency_end, "ms")
        g.add((c1_uri, self.dct.description, Literal(description)))
        g.add((c1_uri, self.set.forAll, self._create_latency_condition(
            g, 
            params.latency,
            params.latency_operator,
            params.latency_end,
            c1_id
        )))

        # Create bandwidth condition
        c2_uri = self.data[c2_id]
        g.add((c2_uri, RDF.type, self.icm.Condition))
        description = self._create_condition_description("Bandwidth", params.bandwidth_operator, params.bandwidth, params.bandwidth_end, "mbit/s")
        g.add((c2_uri, self.dct.description, Literal(description)))
        g.add((c2_uri, self.set.forAll, self._create_bandwidth_condition(
            g, 
            params.bandwidth,
            params.bandwidth_operator,
            params.bandwidth_end,
            c2_id
        )))

        # Create context
        cx_uri = self.data[cx_id]
        g.add((cx_uri, RDF.type, self.icm.Context))
        g.add((cx_uri, self.data.appliesToRegion, self.data[region_id]))
        g.add((cx_uri, self.data.appliesToCustomer, Literal(params.customer)))

        # Create region
        region_uri = self.data[region_id]
        g.add((region_uri, RDF.type, self.geo.Feature))
        g.add((region_uri, self.geo.hasGeometry, self._create_polygon(g, polygon)))

        # Create reporting expectation
        re_uri = self.data[re_id]
        g.add((re_uri, RDF.type, self.icm.ReportingExpectation))
        g.add((re_uri, self.icm.target, self.data["network-slice"]))
        g.add((re_uri, self.dct.description, Literal("Report if expectation is met with reports including metrics related to expectations.")))

        return g.serialize(format="turtle")

    def generate_workload_intent(self, params: WorkloadIntentParams) -> str:
        """Generate a workload intent."""
        g = self._create_base_graph()

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de_id = f"DE{uuid.uuid4().hex}"
        c1_id = f"co_{uuid.uuid4().hex}"
        cx_id = f"CX{uuid.uuid4().hex}"
        re_id = f"RE{uuid.uuid4().hex}"

        # Create intent
        intent_uri = self.data[intent_id]
        g.add((intent_uri, RDF.type, self.icm.Intent))
        g.add((intent_uri, self.log.allOf, self.data[de_id]))
        g.add((intent_uri, self.log.allOf, self.data[re_id]))

        # Add handler and owner if provided
        if params.handler:
            g.add((intent_uri, self.imo.handler, Literal(params.handler)))
        if params.owner:
            g.add((intent_uri, self.imo.owner, Literal(params.owner)))

        # Create deployment expectation
        de_uri = self.data[de_id]
        g.add((de_uri, RDF.type, self.data.DeploymentExpectation))
        g.add((de_uri, self.icm.target, self.data["deployment"]))
        g.add((de_uri, self.dct.description, Literal(params.description or "Deploy application to Edge Data Center")))
        g.add((de_uri, self.log.allOf, self.data[c1_id]))
        g.add((de_uri, self.log.allOf, self.data[cx_id]))

        # Create condition
        c1_uri = self.data[c1_id]
        g.add((c1_uri, RDF.type, self.icm.Condition))
        description = self._create_condition_description("Compute latency", params.compute_latency_operator, params.compute_latency, params.compute_latency_end, "ms")
        g.add((c1_uri, self.dct.description, Literal(description)))
        g.add((c1_uri, self.set.forAll, self._create_compute_latency_condition(
            g, 
            params.compute_latency,
            params.compute_latency_operator,
            params.compute_latency_end,
            c1_id
        )))

        # Create context
        cx_uri = self.data[cx_id]
        g.add((cx_uri, RDF.type, self.icm.Context))
        g.add((cx_uri, self.data.DataCenter, Literal(params.datacenter)))
        g.add((cx_uri, self.data.Application, Literal(params.application)))
        g.add((cx_uri, self.data.DeploymentDescriptor, Literal(params.descriptor)))

        # Create reporting expectation
        re_uri = self.data[re_id]
        g.add((re_uri, RDF.type, self.icm.ReportingExpectation))
        g.add((re_uri, self.icm.target, self.data["deployment"]))
        g.add((re_uri, self.dct.description, Literal("Report if expectation is met with reports including metrics related to expectations.")))

        return g.serialize(format="turtle")

    def generate_combined_intent(self, params: CombinedIntentParams) -> str:
        """Generate a combined network and workload intent."""
        g = self._create_base_graph()
        
        # Get polygon from location if provided
        if params.location and not params.polygon:
            try:
                polygon = get_polygon_from_location(params.location)
            except Exception:
                polygon = get_default_polygon()
        elif params.polygon:
            polygon = params.polygon
        else:
            polygon = get_default_polygon()

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de1_id = f"NE{uuid.uuid4().hex}"
        de2_id = f"DE{uuid.uuid4().hex}"
        c1_id = f"co_{uuid.uuid4().hex}"
        c2_id = f"co_{uuid.uuid4().hex}"
        c3_id = f"co_{uuid.uuid4().hex}"
        cx1_id = f"CX{uuid.uuid4().hex}"
        cx2_id = f"CX{uuid.uuid4().hex}"
        region_id = f"RG{uuid.uuid4().hex}"
        re1_id = f"RE{uuid.uuid4().hex}"
        re2_id = f"RE{uuid.uuid4().hex}"

        # Create intent
        intent_uri = self.data[intent_id]
        g.add((intent_uri, RDF.type, self.icm.Intent))
        g.add((intent_uri, self.log.allOf, self.data[de1_id]))
        g.add((intent_uri, self.log.allOf, self.data[de2_id]))
        g.add((intent_uri, self.log.allOf, self.data[re1_id]))
        g.add((intent_uri, self.log.allOf, self.data[re2_id]))

        # Add handler and owner if provided
        if params.handler:
            g.add((intent_uri, self.imo.handler, Literal(params.handler)))
        if params.owner:
            g.add((intent_uri, self.imo.owner, Literal(params.owner)))

        # Create network expectation
        de1_uri = self.data[de1_id]
        g.add((de1_uri, RDF.type, self.data.NetworkExpectation))
        g.add((de1_uri, self.icm.target, self.data["network-slice"]))
        g.add((de1_uri, self.dct.description, Literal(params.description or "Ensure QoS guarantees for network slice")))
        g.add((de1_uri, self.log.allOf, self.data[c1_id]))
        g.add((de1_uri, self.log.allOf, self.data[c2_id]))
        g.add((de1_uri, self.log.allOf, self.data[cx1_id]))

        # Create deployment expectation
        de2_uri = self.data[de2_id]
        g.add((de2_uri, RDF.type, self.data.DeploymentExpectation))
        g.add((de2_uri, self.icm.target, self.data["deployment"]))
        g.add((de2_uri, self.dct.description, Literal(params.description or "Deploy application to Edge Data Center")))
        g.add((de2_uri, self.log.allOf, self.data[c3_id]))
        g.add((de2_uri, self.log.allOf, self.data[cx2_id]))

        # Create network conditions
        c1_uri = self.data[c1_id]
        g.add((c1_uri, RDF.type, self.icm.Condition))
        description = self._create_condition_description("Latency", params.latency_operator, params.latency, params.latency_end, "ms")
        g.add((c1_uri, self.dct.description, Literal(description)))
        g.add((c1_uri, self.set.forAll, self._create_latency_condition(
            g, 
            params.latency,
            params.latency_operator,
            params.latency_end,
            c1_id
        )))

        c2_uri = self.data[c2_id]
        g.add((c2_uri, RDF.type, self.icm.Condition))
        description = self._create_condition_description("Bandwidth", params.bandwidth_operator, params.bandwidth, params.bandwidth_end, "mbit/s")
        g.add((c2_uri, self.dct.description, Literal(description)))
        g.add((c2_uri, self.set.forAll, self._create_bandwidth_condition(
            g, 
            params.bandwidth,
            params.bandwidth_operator,
            params.bandwidth_end,
            c2_id
        )))

        # Create workload condition
        c3_uri = self.data[c3_id]
        g.add((c3_uri, RDF.type, self.icm.Condition))
        description = self._create_condition_description("Compute latency", params.compute_latency_operator, params.compute_latency, params.compute_latency_end, "ms")
        g.add((c3_uri, self.dct.description, Literal(description)))
        g.add((c3_uri, self.set.forAll, self._create_compute_latency_condition(
            g, 
            params.compute_latency,
            params.compute_latency_operator,
            params.compute_latency_end,
            c3_id
        )))

        # Create contexts
        cx1_uri = self.data[cx1_id]
        g.add((cx1_uri, RDF.type, self.icm.Context))
        g.add((cx1_uri, self.data.appliesToRegion, self.data[region_id]))
        g.add((cx1_uri, self.data.appliesToCustomer, Literal(params.customer)))

        cx2_uri = self.data[cx2_id]
        g.add((cx2_uri, RDF.type, self.icm.Context))
        g.add((cx2_uri, self.data.DataCenter, Literal(params.datacenter)))
        g.add((cx2_uri, self.data.Application, Literal(params.application)))
        g.add((cx2_uri, self.data.DeploymentDescriptor, Literal(params.descriptor)))

        # Create region
        region_uri = self.data[region_id]
        g.add((region_uri, RDF.type, self.geo.Feature))
        g.add((region_uri, self.geo.hasGeometry, self._create_polygon(g, polygon)))

        # Create reporting expectations
        re1_uri = self.data[re1_id]
        g.add((re1_uri, RDF.type, self.icm.ReportingExpectation))
        g.add((re1_uri, self.icm.target, self.data["network-slice"]))
        g.add((re1_uri, self.dct.description, Literal("Report if expectation is met with reports including metrics related to expectations.")))

        re2_uri = self.data[re2_id]
        g.add((re2_uri, RDF.type, self.icm.ReportingExpectation))
        g.add((re2_uri, self.icm.target, self.data["deployment"]))
        g.add((re2_uri, self.dct.description, Literal("Report if expectation is met with reports including metrics related to expectations.")))

        return g.serialize(format="turtle")

    def _create_base_graph(self) -> Graph:
        """Create a base RDF graph with all required namespace bindings."""
        g = Graph()
        g.bind("icm", self.icm)
        g.bind("dct", self.dct)
        g.bind("xsd", self.xsd)
        g.bind("rdf", self.rdf)
        g.bind("rdfs", self.rdfs)
        g.bind("log", self.log)
        g.bind("set", self.set)
        g.bind("quan", self.quan)
        g.bind("geo", self.geo)
        g.bind("data5g", self.data)
        g.bind("imo", self.imo)
        return g

    def _create_condition_description(self, metric_name: str, operator: str, value: float, end_value: float = None, unit: str = "") -> str:
        """Create a description for a condition."""
        if operator == "inRange" and end_value is not None:
            return f"{metric_name} condition quan:{operator}: {value} to {end_value}{unit}"
        else:
            return f"{metric_name} condition quan:{operator}: {value}{unit}"

    def _create_latency_condition(self, g: Graph, latency: float, operator: str = "smaller", latency_end: float = None, condition_id: str = None) -> BNode:
        """Create a latency condition."""
        bnode = BNode()
        metric_name = f"networklatency_{condition_id}" if condition_id else "5GTelenorLatency"
        g.add((bnode, self.icm.valuesOfTargetProperty, self.data[metric_name]))
        
        if operator == "inRange" and latency_end is not None:
            self._create_range_condition(g, bnode, operator, latency, latency_end, "ms")
        else:
            self._create_simple_condition(g, bnode, operator, latency, "ms")
        
        return bnode

    def _create_bandwidth_condition(self, g: Graph, bandwidth: float, operator: str = "larger", bandwidth_end: float = None, condition_id: str = None) -> BNode:
        """Create a bandwidth condition."""
        bnode = BNode()
        metric_name = f"bandwidth_{condition_id}" if condition_id else "5GTelenorBandwidth"
        g.add((bnode, self.icm.valuesOfTargetProperty, self.data[metric_name]))
        
        if operator == "inRange" and bandwidth_end is not None:
            self._create_range_condition(g, bnode, operator, bandwidth, bandwidth_end, "mbit/s")
        else:
            self._create_simple_condition(g, bnode, operator, bandwidth, "mbit/s")
        
        return bnode

    def _create_compute_latency_condition(self, g: Graph, latency: float, operator: str = "smaller", latency_end: float = None, condition_id: str = None) -> BNode:
        """Create a compute latency condition."""
        bnode = BNode()
        metric_name = f"computelatency_{condition_id}" if condition_id else "ComputeLatency"
        g.add((bnode, self.icm.valuesOfTargetProperty, self.data[metric_name]))
        
        if operator == "inRange" and latency_end is not None:
            self._create_range_condition(g, bnode, operator, latency, latency_end, "ms")
        else:
            self._create_simple_condition(g, bnode, operator, latency, "ms")
        
        return bnode

    def _create_simple_condition(self, g: Graph, bnode: BNode, operator: str, value: float, unit: str):
        """Create a simple condition (not inRange)."""
        value_bnode = BNode()
        g.add((bnode, self.operator_map[operator], value_bnode))
        g.add((value_bnode, self.rdf.value, Literal(value, datatype=self.xsd.decimal)))
        g.add((value_bnode, self.quan.unit, Literal(unit)))

    def _create_range_condition(self, g: Graph, bnode: BNode, operator: str, lower_value: float, upper_value: float, unit: str):
        """Create an inRange condition."""
        lower_bnode = BNode()
        g.add((lower_bnode, self.rdf.value, Literal(lower_value, datatype=self.xsd.decimal)))
        g.add((lower_bnode, self.quan.unit, Literal(unit)))
        
        upper_bnode = BNode()
        g.add((upper_bnode, self.rdf.value, Literal(upper_value, datatype=self.xsd.decimal)))
        g.add((upper_bnode, self.quan.unit, Literal(unit)))
        
        # Create a list of the three arguments manually
        list_bnode = BNode()
        g.add((bnode, self.operator_map[operator], list_bnode))
        
        # First element (metric name) - get from the bnode's valuesOfTargetProperty
        metric_uri = None
        for s, p, o in g:
            if s == bnode and p == self.icm.valuesOfTargetProperty:
                metric_uri = o
                break
        
        if metric_uri:
            g.add((list_bnode, self.rdf.first, metric_uri))
        list_bnode2 = BNode()
        g.add((list_bnode, self.rdf.rest, list_bnode2))
        
        # Second element (lower bound)
        g.add((list_bnode2, self.rdf.first, lower_bnode))
        list_bnode3 = BNode()
        g.add((list_bnode2, self.rdf.rest, list_bnode3))
        
        # Third element (upper bound)
        g.add((list_bnode3, self.rdf.first, upper_bnode))
        g.add((list_bnode3, self.rdf.rest, self.rdf.nil))

    def _create_polygon(self, g: Graph, wkt: str) -> BNode:
        """Create a polygon geometry."""
        bnode = BNode()
        g.add((bnode, RDF.type, self.geo.Polygon))
        g.add((bnode, self.geo.asWKT, Literal(wkt, datatype=self.geo.wktLiteral)))
        return bnode
