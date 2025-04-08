import requests
from rdflib import Graph, URIRef, Literal, Namespace
import json
import re
import os
from datetime import datetime

class GraphDBClient:
    def __init__(self, base_url="http://start5g-1.cs.uit.no:7200", repository="intents"):
        self.base_url = base_url
        self.repository = repository
        self.sparql_endpoint = f"{base_url}/repositories/{repository}/statements"
        self.query_endpoint = f"{base_url}/repositories/{repository}/sparql"
        # Create intents directory if it doesn't exist
        self.intents_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'intents')
        os.makedirs(self.intents_dir, exist_ok=True)

    def store_intent(self, intent_data, file_path=None):
        """Store an intent in GraphDB and return its ID"""
        headers = {
            'Content-Type': 'application/x-turtle'
        }
        response = requests.post(
            self.sparql_endpoint,
            data=intent_data,
            headers=headers
        )
        response.raise_for_status()
        
        # Extract intent ID from the response
        # The intent ID is in the form "I<uuid>" in the turtle data
        match = re.search(r'data5g:I([a-f0-9]{8})', intent_data)
        if match:
            intent_id = match.group(1)
            
            # Generate a timestamp for the filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"intent_{intent_id}_{timestamp}.ttl"
            file_path = os.path.join(self.intents_dir, filename)
            
            # Save the Turtle data to a file
            with open(file_path, 'w') as f:
                f.write(intent_data)
            
            # Store the relative path as a property of the intent
            relative_path = os.path.relpath(file_path, os.path.dirname(os.path.dirname(__file__)))
            file_triple = f"""
            <http://5g4data.eu/5g4data#I{intent_id}> <http://5g4data.eu/5g4data#sourceFile> "{relative_path}" .
            """
            response = requests.post(
                self.sparql_endpoint,
                data=file_triple,
                headers=headers
            )
            response.raise_for_status()
            
            return intent_id
        return None

    def get_intent(self, intent_id: str) -> str:
        """Get all statements related to an intent using property path traversal."""
        try:
            # Use SPARQL CONSTRUCT with property path traversal
            construct_query = f"""
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
            PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
            PREFIX set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/>
            PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
            PREFIX dct: <http://purl.org/dc/terms/>
            PREFIX geo: <http://www.opengis.net/ont/geosparql#>
            
            CONSTRUCT {{
                ?s ?p ?o .
            }}
            WHERE {{
                ?s ?p ?o .
                <http://5g4data.eu/5g4data#I{intent_id}> (^!rdf:type|!rdf:type)* ?s .
            }}
            """
            
            headers = {
                "Accept": "text/turtle",
                "Content-Type": "application/sparql-query"
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.repository}",
                data=construct_query.encode("utf-8"),
                headers=headers
            )
            response.raise_for_status()
            
            # Parse the response into an RDFlib Graph to control serialization
            g = Graph()
            g.parse(data=response.text, format="turtle")
            
            # Bind the prefixes we want to use
            g.bind("data5g", Namespace("http://5g4data.eu/5g4data#"))
            g.bind("icm", Namespace("http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/"))
            g.bind("log", Namespace("http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/"))
            g.bind("set", Namespace("http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/"))
            g.bind("quan", Namespace("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/"))
            g.bind("dct", Namespace("http://purl.org/dc/terms/"))
            g.bind("geo", Namespace("http://www.opengis.net/ont/geosparql#"))
            g.bind("rdf", Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#"))
            
            # Serialize with our preferred prefixes
            return g.serialize(format="turtle")
            
        except requests.exceptions.RequestException as e:
            print(f"Error retrieving intent data: {str(e)}")
            raise Exception(f"Failed to retrieve intent data: {str(e)}")

    def query_intents(self, query):
        """Execute a SPARQL query on the stored intents"""
        headers = {
            'Accept': 'application/sparql-results+json',
            'Content-Type': 'application/sparql-query'
        }
        response = requests.post(
            f"{self.base_url}/repositories/{self.repository}",
            data=query.encode("utf-8"),
            headers=headers
        )
        response.raise_for_status()
        return response.json()

    def delete_all_intents(self):
        """Delete all intents from the repository"""
        # SPARQL query to delete all triples
        delete_query = """
        DELETE {
            ?s ?p ?o
        }
        WHERE {
            ?s ?p ?o
        }
        """
        headers = {
            'Content-Type': 'application/sparql-update'
        }
        response = requests.post(
            self.sparql_endpoint,
            data=delete_query,
            headers=headers
        )
        response.raise_for_status()
        return response.text

    def delete_intent(self, intent_id: str):
        """Delete a specific intent and its associated file"""
        try:
            # First, get the source file path
            query = f"""
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            SELECT ?sourceFile
            WHERE {{
                <http://5g4data.eu/5g4data#I{intent_id}> data5g:sourceFile ?sourceFile .
            }}
            """
            
            headers = {
                'Accept': 'application/sparql-results+json',
                'Content-Type': 'application/sparql-query'
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.repository}",
                data=query.encode("utf-8"),
                headers=headers
            )
            response.raise_for_status()
            results = response.json()
            
            # Delete the file if it exists
            if results['results']['bindings']:
                source_file = results['results']['bindings'][0]['sourceFile']['value']
                file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), source_file)
                if os.path.exists(file_path):
                    os.remove(file_path)
            
            # Delete all triples related to the intent
            delete_query = f"""
            DELETE {{
                ?s ?p ?o
            }}
            WHERE {{
                ?s ?p ?o .
                <http://5g4data.eu/5g4data#I{intent_id}> (^!rdf:type|!rdf:type)* ?s .
            }}
            """
            
            headers = {
                'Content-Type': 'application/sparql-update'
            }
            
            response = requests.post(
                self.sparql_endpoint,
                data=delete_query,
                headers=headers
            )
            response.raise_for_status()
            
            return response.text
            
        except requests.exceptions.RequestException as e:
            print(f"Error deleting intent: {str(e)}")
            raise Exception(f"Failed to delete intent: {str(e)}")

    def store_report(self, report_data):
        """Store an intent report in GraphDB"""
        headers = {
            'Content-Type': 'application/x-turtle'
        }
        response = requests.post(
            self.sparql_endpoint,
            data=report_data,
            headers=headers
        )
        response.raise_for_status()
        return response.text

    def get_last_report(self, intent_id: str) -> str:
        """Get the most recent complete report for a given intent."""
        try:
            # Query to get the complete latest report with all its properties
            query = """
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
            PREFIX ir: <http://example.org/intent-reports#>
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            
            CONSTRUCT {
                ?report ?p ?o .
                ?o ?p2 ?o2 .
            }
            WHERE {
                {
                    SELECT ?report
                    WHERE {
                        ?report a icm:IntentReport ;
                                icm:about data5g:I%s ;
                                icm:reportGenerated ?generated .
                    }
                    ORDER BY DESC(xsd:dateTime(?generated))
                    LIMIT 1
                }
                ?report ?p ?o .
                OPTIONAL { ?o ?p2 ?o2 }
            }
            """ % intent_id

            headers = {
                "Accept": "text/turtle",
                "Content-Type": "application/sparql-query"
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.repository}",
                data=query.encode("utf-8"),
                headers=headers
            )
            response.raise_for_status()
            
            # Parse the response into an RDFlib Graph to control serialization
            g = Graph()
            g.parse(data=response.text, format="turtle")
            
            # Bind the prefixes we want to use for cleaner output
            g.bind("icm", Namespace("http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/"))
            g.bind("ir", Namespace("http://example.org/intent-reports#"))
            g.bind("data5g", Namespace("http://5g4data.eu/5g4data#"))
            g.bind("xsd", Namespace("http://www.w3.org/2001/XMLSchema#"))
            
            # Serialize with sorted triples for consistent output
            return g.serialize(format="turtle")
            
        except Exception as e:
            print(f"Error getting last report: {str(e)}")
            raise 

    def get_highest_report_number(self, intent_id: str) -> int:
        """Get the highest report number for a given intent."""
        try:
            query = """
            PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            
            SELECT (MAX(xsd:integer(?reportNum)) as ?maxReportNum)
            WHERE {
                ?report a icm:IntentReport ;
                        icm:about data5g:I%s ;
                        icm:reportNumber ?reportNum .
            }
            """ % intent_id

            print(f"Executing query for intent {intent_id}")  # Debug log
            
            headers = {
                "Accept": "application/sparql-results+json",
                "Content-Type": "application/sparql-query"
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.repository}",
                data=query.encode("utf-8"),
                headers=headers
            )
            response.raise_for_status()
            
            result = response.json()
            # When no reports exist, SPARQL returns a binding with no value
            if (not result["results"]["bindings"] or 
                not result["results"]["bindings"][0] or 
                "maxReportNum" not in result["results"]["bindings"][0] or 
                not result["results"]["bindings"][0]["maxReportNum"].get("value")):
                return 0  # Will result in next number being 1
            
            return int(result["results"]["bindings"][0]["maxReportNum"]["value"])
            
        except Exception as e:
            print(f"Error getting highest report number: {str(e)}")
            raise 