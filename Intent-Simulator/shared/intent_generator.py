from rdflib import Graph, Namespace, RDF, Literal, XSD, URIRef, BNode
from rdflib.namespace import RDFS
import uuid
import time
import random
import openai
import os

class IntentGenerator:
    def __init__(self):
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

    def generate(self, intent_type, parameters):
        if intent_type == "network":
            return self._generate_network_intent(parameters)
        elif intent_type == "workload":
            return self._generate_workload_intent(parameters)
        elif intent_type == "combined":
            return self._generate_combined_intent(parameters)
        else:
            raise ValueError(f"Unknown intent type: {intent_type}")

    def generate_sequence(self, intent_type, parameters, count=1, interval=0):
        intents = []
        for _ in range(count):
            intent = self.generate(intent_type, parameters)
            intents.append(intent)
            if interval > 0 and _ < count - 1:
                time.sleep(interval)
        return intents

    def _generate_network_intent(self, params):
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

        # Get polygon from location if provided
        if "location" in params and params["location"]:
            polygon = self._get_polygon_from_location(params["location"])
        else:
            polygon = "POLYGON((69.673545 18.921344, 69.673448 18.924026, 69.672195 18.923903, 69.672356 18.921052))"

        # Generate unique IDs (Will the first 8 characters of the UUID be enough?)
        intent_id = f"I{uuid.uuid4().hex}"
        de_id = f"NE{uuid.uuid4().hex}"
        c1_id = f"CO{uuid.uuid4().hex}"
        c2_id = f"CO{uuid.uuid4().hex}"
        cx_id = f"CX{uuid.uuid4().hex}"
        region_id = f"RG{uuid.uuid4().hex}"
        re_id = f"RE{uuid.uuid4().hex}"

        # Create intent
        intent_uri = self.data[intent_id]
        g.add((intent_uri, RDF.type, self.icm.Intent))
        g.add((intent_uri, self.log.allOf, self.data[de_id]))
        g.add((intent_uri, self.log.allOf, self.data[re_id]))

        # Add handler and owner if provided
        if "handler" in params and params["handler"]:
            g.add((intent_uri, self.imo.handler, Literal(params["handler"], datatype=self.xsd.string)))
        if "owner" in params and params["owner"]:
            g.add((intent_uri, self.imo.owner, Literal(params["owner"], datatype=self.xsd.string)))

        # Create delivery expectation
        de_uri = self.data[de_id]
        g.add((de_uri, RDF.type, self.data.NetworkExpectation))
        g.add((de_uri, self.icm.target, self.data["network-slice"]))
        g.add((de_uri, self.dct.description, Literal(params.get("description", "Ensure QoS guarantees for network slice"))))
        g.add((de_uri, self.log.allOf, self.data[c1_id]))
        g.add((de_uri, self.log.allOf, self.data[c2_id]))
        g.add((de_uri, self.log.allOf, self.data[cx_id]))

        # Create conditions
        c1_uri = self.data[c1_id]
        g.add((c1_uri, RDF.type, self.icm.Condition))
        description = f"Latency value condition: {params.get('latency', 20)}"
        g.add((c1_uri, self.dct.description, Literal(description)))
        g.add((c1_uri, self.set.forAll, self._create_latency_condition(g, params.get("latency", 20))))

        c2_uri = self.data[c2_id]
        g.add((c2_uri, RDF.type, self.icm.Condition))
        description = f"Bandwidth value condition: {params.get('bandwidth', 300)}"
        g.add((c2_uri, self.dct.description, Literal(description)))
        g.add((c2_uri, self.set.forAll, self._create_bandwidth_condition(g, params.get("bandwidth", 300))))

        # Create context
        cx_uri = self.data[cx_id]
        g.add((cx_uri, RDF.type, self.icm.Context))
        g.add((cx_uri, self.data.appliesToRegion, self.data[region_id]))
        g.add((cx_uri, self.data.appliesToCustomer, Literal(params.get("customer", "+47 90914547"))))

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

    def _generate_workload_intent(self, params):
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

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de_id = f"DE{uuid.uuid4().hex}"
        c1_id = f"CO{uuid.uuid4().hex}"
        cx_id = f"CX{uuid.uuid4().hex}"
        re_id = f"RE{uuid.uuid4().hex}"

        # Create intent
        intent_uri = self.data[intent_id]
        g.add((intent_uri, RDF.type, self.icm.Intent))
        g.add((intent_uri, self.log.allOf, self.data[de_id]))
        g.add((intent_uri, self.log.allOf, self.data[re_id]))

        # Add handler and owner if provided
        if "handler" in params and params["handler"]:
            g.add((intent_uri, self.imo.handler, Literal(params["handler"])))
        if "owner" in params and params["owner"]:
            g.add((intent_uri, self.imo.owner, Literal(params["owner"])))

        # Create deployment expectation
        de_uri = self.data[de_id]
        g.add((de_uri, RDF.type, self.data.DeploymentExpectation))
        g.add((de_uri, self.icm.target, self.data["deployment"]))
        g.add((de_uri, self.dct.description, Literal(params.get("description", "Deploy application to Edge Data Center"))))
        g.add((de_uri, self.log.allOf, self.data[c1_id]))
        g.add((de_uri, self.log.allOf, self.data[cx_id]))

        # Create condition
        c1_uri = self.data[c1_id]
        g.add((c1_uri, RDF.type, self.icm.Condition))
        g.add((c1_uri, self.set.forAll, self._create_compute_latency_condition(g, params.get("latency", 20))))

        # Create context
        cx_uri = self.data[cx_id]
        g.add((cx_uri, RDF.type, self.icm.Context))
        g.add((cx_uri, self.data.DataCenter, Literal(params.get("datacenter", "EC1"))))
        g.add((cx_uri, self.data.Application, Literal(params.get("application", "AR-retail-app"))))
        g.add((cx_uri, self.data.DeploymentDescriptor, Literal(params.get("descriptor", "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml"))))

        # Create reporting expectation
        re_uri = self.data[re_id]
        g.add((re_uri, RDF.type, self.icm.ReportingExpectation))
        g.add((re_uri, self.icm.target, self.data["deployment"]))
        g.add((re_uri, self.dct.description, Literal("Report if expectation is met with reports including metrics related to expectations.")))

        return g.serialize(format="turtle")

    def _generate_combined_intent(self, params):
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

        # Get polygon from location if provided
        if "location" in params and params["location"]:
            polygon = self._get_polygon_from_location(params["location"])
        else:
            polygon = "POLYGON((69.673545 18.921344, 69.673448 18.924026, 69.672195 18.923903, 69.672356 18.921052))"

        # Generate unique IDs
        intent_id = f"I{uuid.uuid4().hex}"
        de1_id = f"NE{uuid.uuid4().hex}"
        de2_id = f"DE{uuid.uuid4().hex}"
        c1_id = f"CO{uuid.uuid4().hex}"
        c2_id = f"CO{uuid.uuid4().hex}"
        c3_id = f"CO{uuid.uuid4().hex}"
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
        if "handler" in params and params["handler"]:
            g.add((intent_uri, self.imo.handler, Literal(params["handler"])))
        if "owner" in params and params["owner"]:
            g.add((intent_uri, self.imo.owner, Literal(params["owner"])))

        # Create network expectation
        de1_uri = self.data[de1_id]
        g.add((de1_uri, RDF.type, self.data.NetworkExpectation))
        g.add((de1_uri, self.icm.target, self.data["network-slice"]))
        g.add((de1_uri, self.dct.description, Literal(params.get("description", "Ensure QoS guarantees for network slice"))))
        g.add((de1_uri, self.log.allOf, self.data[c1_id]))
        g.add((de1_uri, self.log.allOf, self.data[c2_id]))
        g.add((de1_uri, self.log.allOf, self.data[cx1_id]))

        # Create deployment expectation
        de2_uri = self.data[de2_id]
        g.add((de2_uri, RDF.type, self.data.DeploymentExpectation))
        g.add((de2_uri, self.icm.target, self.data["deployment"]))
        g.add((de2_uri, self.dct.description, Literal(params.get("description", "Deploy application to Edge Data Center"))))
        g.add((de2_uri, self.log.allOf, self.data[c3_id]))
        g.add((de2_uri, self.log.allOf, self.data[cx2_id]))

        # Create conditions
        c1_uri = self.data[c1_id]
        g.add((c1_uri, RDF.type, self.icm.Condition))
        g.add((c1_uri, self.set.forAll, self._create_latency_condition(g, params.get("latency", 20))))

        c2_uri = self.data[c2_id]
        g.add((c2_uri, RDF.type, self.icm.Condition))
        g.add((c2_uri, self.set.forAll, self._create_bandwidth_condition(g, params.get("bandwidth", 300))))

        c3_uri = self.data[c3_id]
        g.add((c3_uri, RDF.type, self.icm.Condition))
        g.add((c3_uri, self.set.forAll, self._create_compute_latency_condition(g, params.get("latency", 20))))

        # Create contexts
        cx1_uri = self.data[cx1_id]
        g.add((cx1_uri, RDF.type, self.icm.Context))
        g.add((cx1_uri, self.data.appliesToRegion, self.data[region_id]))
        g.add((cx1_uri, self.data.appliesToCustomer, Literal(params.get("customer", "+47 90914547"))))

        cx2_uri = self.data[cx2_id]
        g.add((cx2_uri, RDF.type, self.icm.Context))
        g.add((cx2_uri, self.data.DataCenter, Literal(params.get("datacenter", "EC1"))))
        g.add((cx2_uri, self.data.Application, Literal(params.get("application", "AR-retail-app"))))
        g.add((cx2_uri, self.data.DeploymentDescriptor, Literal(params.get("descriptor", "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml"))))

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

    def _create_latency_condition(self, g, latency):
        bnode = BNode()
        value_bnode = BNode()
        g.add((bnode, self.icm.valuesOfTargetProperty, self.data["5GTelenorLatency"]))
        g.add((bnode, self.quan.smaller, value_bnode))
        g.add((value_bnode, self.rdf.value, Literal(latency, datatype=self.xsd.decimal)))
        g.add((value_bnode, self.quan.unit, Literal("ms")))
        return bnode

    def _create_bandwidth_condition(self, g, bandwidth):
        bnode = BNode()
        value_bnode = BNode()
        g.add((bnode, self.icm.valuesOfTargetProperty, self.data["5GTelenorBandwidth"]))
        g.add((bnode, self.quan.larger, value_bnode))
        g.add((value_bnode, self.rdf.value, Literal(bandwidth, datatype=self.xsd.decimal)))
        g.add((value_bnode, self.quan.unit, Literal("mbit/s")))
        return bnode

    def _create_compute_latency_condition(self, g, latency):
        bnode = BNode()
        value_bnode = BNode()
        g.add((bnode, self.icm.valuesOfTargetProperty, self.data["ComputeLatency"]))
        g.add((bnode, self.quan.smaller, value_bnode))
        g.add((value_bnode, self.rdf.value, Literal(latency, datatype=self.xsd.decimal)))
        g.add((value_bnode, self.quan.unit, Literal("ms")))
        return bnode

    def _create_polygon(self, g, wkt):
        bnode = BNode()
        g.add((bnode, RDF.type, self.geo.Polygon))
        g.add((bnode, self.geo.asWKT, Literal(wkt, datatype=self.geo.wktLiteral)))
        return bnode

    def _get_polygon_from_location(self, location):
        """Get a polygon for a location using ChatGPT 4o-mini"""
        import openai
        import os
        
        try:
            # Read the prompt template
            # Get the project root directory (one level up from shared)
            project_root = os.path.dirname(os.path.dirname(__file__))
            template_path = os.path.join(project_root, 'templates', 'polygonPromptTemplate.txt')
            print(f"Looking for template at: {template_path}")  # Debug print
            with open(template_path, 'r') as f:
                prompt_template = f.read()
            
            # Add the location to the prompt
            prompt = prompt_template + location
            print(f"Generated prompt: {prompt}")  # Debug print
            
            # Get the polygon from ChatGPT 4o-mini
            api_key = os.getenv('OPENAI_API_KEY')
            if not api_key:
                raise ValueError("OPENAI_API_KEY environment variable is not set")
            
            client = openai.OpenAI(api_key=api_key)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            
            # Extract the polygon from the response
            polygon = response.choices[0].message.content.strip()
            print(f"Received polygon: {polygon}")  # Debug print
            return polygon
        except Exception as e:
            print(f"Error getting polygon from location: {str(e)}")  # Debug print
            import traceback
            print(traceback.format_exc())  # Print full traceback
            raise

    def _create_blank_node(self, triples):
        bnode = BNode()
        for pred, obj in triples:
            yield (bnode, pred, obj) 