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
        
        # Convert params object to dict if needed, otherwise keep as dict
        # This allows arbitrary parameter names to be used
        if isinstance(parameters, dict):
            # Keep as dict - will be handled dynamically
            pass
        elif isinstance(parameters, (NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams)):
            # Convert dataclass to dict for dynamic handling
            parameters = {k: v for k, v in parameters.__dict__.items() if v is not None}
        else:
            raise ValueError(f"Invalid parameters type: {type(parameters)}")
        
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

    def generate_network_intent(self, params: Union[NetworkIntentParams, Dict[str, Any]]) -> str:
        """Generate a network intent with dynamic parameter support."""
        # Convert params object to dict if needed
        if not isinstance(params, dict):
            params = {k: v for k, v in params.__dict__.items() if v is not None}
        
        g = self._create_base_graph()
        
        # Get polygon from location if provided
        location = params.get('location')
        polygon_param = params.get('polygon')
        if location and not polygon_param:
            try:
                polygon = get_polygon_from_location(location)
            except Exception:
                polygon = get_default_polygon()
        elif polygon_param:
            polygon = polygon_param
        else:
            polygon = get_default_polygon()

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de_id = f"NE{uuid.uuid4().hex}"
        cx_id = f"CX{uuid.uuid4().hex}"
        region_id = f"RG{uuid.uuid4().hex}"
        re_id = f"RE{uuid.uuid4().hex}"

        # Create intent
        intent_uri = self.data[intent_id]
        g.add((intent_uri, RDF.type, self.icm.Intent))
        g.add((intent_uri, self.log.allOf, self.data[de_id]))
        g.add((intent_uri, self.log.allOf, self.data[re_id]))

        # Add handler and owner if provided
        if params.get('handler'):
            g.add((intent_uri, self.imo.handler, Literal(params['handler'], datatype=self.xsd.string)))
        if params.get('owner'):
            g.add((intent_uri, self.imo.owner, Literal(params['owner'], datatype=self.xsd.string)))
        if params.get('intent_description'):
            g.add((intent_uri, self.dct.description, Literal(params['intent_description'])))

        # Create delivery expectation
        de_uri = self.data[de_id]
        g.add((de_uri, RDF.type, self.data.NetworkExpectation))
        g.add((de_uri, RDF.type, self.icm.IntentElement))
        g.add((de_uri, RDF.type, self.icm.Expectation))
        g.add((de_uri, self.icm.target, self.data["network-slice"]))
        g.add((de_uri, self.dct.description, Literal(params.get('description', "Ensure QoS guarantees for network slice"))))
        g.add((de_uri, self.log.allOf, self.data[cx_id]))
        
        # Find all parameter/operator pairs dynamically
        special_fields = {'description', 'intent_description', 'handler', 'owner', 'customer',
                         'datacenter', 'application', 'descriptor', 'location', 'polygon'}
        param_pairs = self._find_parameter_pairs(params, special_fields)
        
        # Create conditions for each parameter pair
        for pair in param_pairs:
            c_id = f"CO{uuid.uuid4().hex}"
            c_uri = self.data[c_id]
            g.add((c_uri, RDF.type, self.icm.Condition))
            
            # Create description
            metric_display_name = pair['name'].replace('-', ' ').replace('_', ' ').title()
            # Determine unit based on parameter name (default to ms, but use mbit/s for bandwidth-like params)
            unit = "mbit/s" if "bandwidth" in pair['name'].lower() or "throughput" in pair['name'].lower() else "ms"
            description = self._create_condition_description(
                metric_display_name, 
                pair['operator'], 
                pair['value'], 
                pair['end'], 
                unit
            )
            g.add((c_uri, self.dct.description, Literal(description)))
            
            # Create the condition
            condition_bnode = self._create_generic_condition(
                g,
                pair['name'],
                pair['value'],
                pair['operator'],
                pair['end'],
                c_id,
                unit
            )
            g.add((c_uri, self.set.forAll, condition_bnode))
            
            # Add condition to delivery expectation
            g.add((de_uri, self.log.allOf, self.data[c_id]))

        # Create context
        cx_uri = self.data[cx_id]
        g.add((cx_uri, RDF.type, self.icm.Context))
        g.add((cx_uri, self.data.appliesToRegion, self.data[region_id]))
        
        customer = params.get('customer', '+47 90914547')
        g.add((cx_uri, self.data.appliesToCustomer, Literal(customer)))

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

    def generate_workload_intent(self, params: Union[WorkloadIntentParams, Dict[str, Any]]) -> str:
        """Generate a workload intent with dynamic parameter support."""
        # Convert params object to dict if needed
        if not isinstance(params, dict):
            params = {k: v for k, v in params.__dict__.items() if v is not None}
        
        g = self._create_base_graph()

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de_id = f"DE{uuid.uuid4().hex}"
        cx_id = f"CX{uuid.uuid4().hex}"
        re_id = f"RE{uuid.uuid4().hex}"

        # Create intent
        intent_uri = self.data[intent_id]
        g.add((intent_uri, RDF.type, self.icm.Intent))
        g.add((intent_uri, self.log.allOf, self.data[de_id]))
        g.add((intent_uri, self.log.allOf, self.data[re_id]))

        # Add handler and owner if provided
        if params.get('handler'):
            g.add((intent_uri, self.imo.handler, Literal(params['handler'])))
        if params.get('owner'):
            g.add((intent_uri, self.imo.owner, Literal(params['owner'])))
        if params.get('intent_description'):
            g.add((intent_uri, self.dct.description, Literal(params['intent_description'])))

        # Create deployment expectation
        de_uri = self.data[de_id]
        g.add((de_uri, RDF.type, self.data.DeploymentExpectation))
        g.add((de_uri, RDF.type, self.icm.IntentElement))
        g.add((de_uri, RDF.type, self.icm.Expectation))
        g.add((de_uri, self.icm.target, self.data["deployment"]))
        
        description = params.get('description', "Deploy application to Edge Data Center")
        g.add((de_uri, self.dct.description, Literal(description)))
        g.add((de_uri, self.log.allOf, self.data[cx_id]))
        
        # Find all parameter/operator pairs dynamically
        special_fields = {'description', 'intent_description', 'handler', 'owner', 'customer',
                         'datacenter', 'application', 'descriptor', 'location', 'polygon'}
        param_pairs = self._find_parameter_pairs(params, special_fields)
        
        # Create conditions for each parameter pair
        for pair in param_pairs:
            c_id = f"CO{uuid.uuid4().hex}"
            c_uri = self.data[c_id]
            g.add((c_uri, RDF.type, self.icm.Condition))
            
            # Create description
            metric_display_name = pair['name'].replace('-', ' ').replace('_', ' ').title()
            description = self._create_condition_description(
                metric_display_name, 
                pair['operator'], 
                pair['value'], 
                pair['end'], 
                "ms"  # Default unit, could be made configurable
            )
            g.add((c_uri, self.dct.description, Literal(description)))
            
            # Create the condition
            condition_bnode = self._create_generic_condition(
                g,
                pair['name'],
                pair['value'],
                pair['operator'],
                pair['end'],
                c_id,
                "ms"  # Default unit
            )
            g.add((c_uri, self.set.forAll, condition_bnode))
            
            # Add condition to deployment expectation
            g.add((de_uri, self.log.allOf, self.data[c_id]))

        # Create context
        cx_uri = self.data[cx_id]
        g.add((cx_uri, RDF.type, self.icm.Context))
        
        datacenter = params.get('datacenter', 'EC1')
        g.add((cx_uri, self.data.DataCenter, Literal(datacenter)))
        
        application = params.get('application', 'AR-retail-app')
        g.add((cx_uri, self.data.Application, Literal(application)))
        
        descriptor = params.get('descriptor', 'http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml')
        g.add((cx_uri, self.data.DeploymentDescriptor, Literal(descriptor)))

        # Create reporting expectation
        re_uri = self.data[re_id]
        g.add((re_uri, RDF.type, self.icm.ReportingExpectation))
        g.add((re_uri, self.icm.target, self.data["deployment"]))
        g.add((re_uri, self.dct.description, Literal("Report if expectation is met with reports including metrics related to expectations.")))

        return g.serialize(format="turtle")

    def generate_combined_intent(self, params: Union[CombinedIntentParams, Dict[str, Any]]) -> str:
        """Generate a combined network and workload intent with dynamic parameter support."""
        # Convert params object to dict if needed
        if not isinstance(params, dict):
            params = {k: v for k, v in params.__dict__.items() if v is not None}
        
        g = self._create_base_graph()
        
        # Get polygon from location if provided
        location = params.get('location')
        polygon_param = params.get('polygon')
        if location and not polygon_param:
            try:
                polygon = get_polygon_from_location(location)
            except Exception:
                polygon = get_default_polygon()
        elif polygon_param:
            polygon = polygon_param
        else:
            polygon = get_default_polygon()

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de1_id = f"NE{uuid.uuid4().hex}"
        de2_id = f"DE{uuid.uuid4().hex}"
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
        if params.get('handler'):
            g.add((intent_uri, self.imo.handler, Literal(params['handler'])))
        if params.get('owner'):
            g.add((intent_uri, self.imo.owner, Literal(params['owner'])))
        if params.get('intent_description'):
            g.add((intent_uri, self.dct.description, Literal(params['intent_description'])))

        # Create network expectation
        de1_uri = self.data[de1_id]
        g.add((de1_uri, RDF.type, self.data.NetworkExpectation))
        g.add((de1_uri, RDF.type, self.icm.IntentElement))
        g.add((de1_uri, RDF.type, self.icm.Expectation))
        g.add((de1_uri, self.icm.target, self.data["network-slice"]))
        g.add((de1_uri, self.dct.description, Literal(params.get('description', "Ensure QoS guarantees for network slice"))))
        g.add((de1_uri, self.log.allOf, self.data[cx1_id]))

        # Create deployment expectation
        de2_uri = self.data[de2_id]
        g.add((de2_uri, RDF.type, self.data.DeploymentExpectation))
        g.add((de2_uri, RDF.type, self.icm.IntentElement))
        g.add((de2_uri, RDF.type, self.icm.Expectation))
        g.add((de2_uri, self.icm.target, self.data["deployment"]))
        g.add((de2_uri, self.dct.description, Literal(params.get('description', "Deploy application to Edge Data Center"))))
        g.add((de2_uri, self.log.allOf, self.data[cx2_id]))

        # Find all parameter/operator pairs dynamically
        special_fields = {'description', 'intent_description', 'handler', 'owner', 'customer',
                         'datacenter', 'application', 'descriptor', 'location', 'polygon'}
        param_pairs = self._find_parameter_pairs(params, special_fields)
        
        # Separate pairs into network and workload based on parameter names
        # This is a heuristic - parameters with "compute" or "workload" in name go to workload,
        # others go to network. You can customize this logic.
        network_pairs = []
        workload_pairs = []
        
        for pair in param_pairs:
            name_lower = pair['name'].lower()
            if 'compute' in name_lower or 'workload' in name_lower or 'deployment' in name_lower:
                workload_pairs.append(pair)
            else:
                network_pairs.append(pair)
        
        # Create network conditions
        for pair in network_pairs:
            c_id = f"CO{uuid.uuid4().hex}"
            c_uri = self.data[c_id]
            g.add((c_uri, RDF.type, self.icm.Condition))
            
            metric_display_name = pair['name'].replace('-', ' ').replace('_', ' ').title()
            unit = "mbit/s" if "bandwidth" in pair['name'].lower() or "throughput" in pair['name'].lower() else "ms"
            description = self._create_condition_description(
                metric_display_name, 
                pair['operator'], 
                pair['value'], 
                pair['end'], 
                unit
            )
            g.add((c_uri, self.dct.description, Literal(description)))
            
            condition_bnode = self._create_generic_condition(
                g,
                pair['name'],
                pair['value'],
                pair['operator'],
                pair['end'],
                c_id,
                unit
            )
            g.add((c_uri, self.set.forAll, condition_bnode))
            g.add((de1_uri, self.log.allOf, self.data[c_id]))

        # Create workload conditions
        for pair in workload_pairs:
            c_id = f"CO{uuid.uuid4().hex}"
            c_uri = self.data[c_id]
            g.add((c_uri, RDF.type, self.icm.Condition))
            
            metric_display_name = pair['name'].replace('-', ' ').replace('_', ' ').title()
            description = self._create_condition_description(
                metric_display_name, 
                pair['operator'], 
                pair['value'], 
                pair['end'], 
                "ms"
            )
            g.add((c_uri, self.dct.description, Literal(description)))
            
            condition_bnode = self._create_generic_condition(
                g,
                pair['name'],
                pair['value'],
                pair['operator'],
                pair['end'],
                c_id,
                "ms"
            )
            g.add((c_uri, self.set.forAll, condition_bnode))
            g.add((de2_uri, self.log.allOf, self.data[c_id]))

        # Create contexts
        cx1_uri = self.data[cx1_id]
        g.add((cx1_uri, RDF.type, self.icm.Context))
        g.add((cx1_uri, self.data.appliesToRegion, self.data[region_id]))
        
        customer = params.get('customer', '+47 90914547')
        g.add((cx1_uri, self.data.appliesToCustomer, Literal(customer)))

        cx2_uri = self.data[cx2_id]
        g.add((cx2_uri, RDF.type, self.icm.Context))
        
        datacenter = params.get('datacenter', 'EC1')
        g.add((cx2_uri, self.data.DataCenter, Literal(datacenter)))
        
        application = params.get('application', 'AR-retail-app')
        g.add((cx2_uri, self.data.Application, Literal(application)))
        
        descriptor = params.get('descriptor', 'http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml')
        g.add((cx2_uri, self.data.DeploymentDescriptor, Literal(descriptor)))

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

    def _find_parameter_pairs(self, params: Dict[str, Any], special_fields: set = None) -> List[Dict[str, Any]]:
        """Find all parameter/operator pairs in the parameters dict.
        
        Looks for pairs where both {name} and {name}_operator exist.
        Also checks for optional {name}_end for inRange operators.
        
        Args:
            params: Dictionary of parameters
            special_fields: Set of field names to exclude from dynamic pairs
        
        Returns:
            List of dicts with keys: 'name', 'value', 'operator', 'end' (optional)
        """
        if special_fields is None:
            special_fields = {
                'description', 'intent_description', 'handler', 'owner', 'customer',
                'datacenter', 'application', 'descriptor', 'location', 'polygon'
            }
        
        pairs = []
        processed = set()
        
        for key, value in params.items():
            # Skip if this is an operator or end parameter (we'll process it with its base)
            if key.endswith('_operator') or key.endswith('_end'):
                continue
            
            # Skip special fields that aren't part of the dynamic pattern
            if key in special_fields:
                continue
            
            # Skip None values
            if value is None:
                continue
            
            operator_key = f"{key}_operator"
            end_key = f"{key}_end"
            
            # Check if operator exists
            if operator_key in params:
                pair = {
                    'name': key,
                    'value': value,
                    'operator': params[operator_key],
                    'end': params.get(end_key)  # Optional
                }
                pairs.append(pair)
                processed.add(key)
                processed.add(operator_key)
                if end_key in params:
                    processed.add(end_key)
        
        return pairs

    def _create_generic_condition(self, g: Graph, param_name: str, value: float, operator: str = "smaller", value_end: float = None, condition_id: str = None, unit: str = "ms") -> BNode:
        """Create a generic condition for any parameter name.
        
        Args:
            g: RDF graph
            param_name: Name of the parameter (e.g., 'p99-token-target')
            value: Parameter value
            operator: Operator (e.g., 'smaller', 'larger', 'inRange')
            value_end: End value for inRange operator
            condition_id: Optional condition ID
            unit: Unit for the value (default: 'ms')
        
        Returns:
            BNode representing the condition
        """
        bnode = BNode()
        
        # Create metric name from parameter name (sanitize for RDF)
        # Replace hyphens and other special chars with underscores
        metric_name = param_name.replace('-', '_').replace(' ', '_')
        metric_name = f"{metric_name}_{condition_id}" if condition_id else metric_name
        
        g.add((bnode, self.icm.valuesOfTargetProperty, self.data[metric_name]))
        
        if operator == "inRange" and value_end is not None:
            self._create_range_condition(g, bnode, operator, value, value_end, unit)
        else:
            self._create_simple_condition(g, bnode, operator, value, unit)
        
        return bnode

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
