import requests
from rdflib import Graph, URIRef, Literal, Namespace
import json
import re
import os
import time
from datetime import datetime

class GraphDBClient:
    def __init__(self, base_url="http://localhost:7200", repository="intents"):
        self.base_url = base_url
        self.repository = repository
        self.sparql_endpoint = f"{base_url}/repositories/{repository}/statements"
        self.query_endpoint = f"{base_url}/repositories/{repository}/sparql"
        # Create intents directory if it doesn't exist
        self.intents_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'intents')
        os.makedirs(self.intents_dir, exist_ok=True)
        print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] GraphDBClient initialized: base_url={base_url}, repository={repository}")

    def store_intent(self, intent_data, file_path=None):
        """Store an intent in GraphDB and return its ID"""
        start_time = time.time()
        print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] ========== Starting store_intent ==========")
        print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Data length: {len(intent_data)} chars")
        print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] GraphDB endpoint: {self.sparql_endpoint}")
        print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Full turtle content:\n{intent_data}")
        
        headers = {
            'Content-Type': 'application/x-turtle'
        }
        
        try:
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Sending POST request to GraphDB (timeout=60s)...")
            request_start = time.time()
            response = requests.post(
                self.sparql_endpoint,
                data=intent_data,
                headers=headers,
                timeout=60  # 60 second timeout
            )
            request_elapsed = time.time() - request_start
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] GraphDB response received in {request_elapsed:.2f}s")
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Response status code: {response.status_code}")
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Response headers: {dict(response.headers)}")
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Response text (first 500 chars): {response.text[:500]}")
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Response text (full): {response.text}")
            
            response.raise_for_status()
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Response status OK - no exceptions raised")
        except requests.exceptions.Timeout:
            elapsed = time.time() - start_time
            print(f"[ERROR] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] GraphDB request timed out after {elapsed:.2f}s")
            raise Exception(f"GraphDB request timed out after 60 seconds")
        except requests.exceptions.RequestException as e:
            elapsed = time.time() - start_time
            print(f"[ERROR] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] GraphDB request failed after {elapsed:.2f}s")
            print(f"[ERROR] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Exception type: {type(e).__name__}")
            print(f"[ERROR] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Exception message: {str(e)}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"[ERROR] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Response status: {e.response.status_code}")
                print(f"[ERROR] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Response text: {e.response.text}")
            raise
        
        # Extract intent ID from the response
        # The intent ID is in the form "I<uuid>" in the turtle data
        print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Extracting intent ID from turtle data...")
        match = re.search(r'data5g:I([a-f0-9]{32})', intent_data)
        if match:
            intent_id = match.group(1)
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Found intent ID: {intent_id}")
            
            # Generate a timestamp for the filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{intent_id}.ttl"
            file_path = os.path.join(self.intents_dir, filename)
            
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Saving intent to file: {file_path}")
            # Save the Turtle data to a file
            with open(file_path, 'w') as f:
                f.write(intent_data)
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] File saved successfully")
            
            total_elapsed = time.time() - start_time
            print(f"[DEBUG] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] ========== store_intent completed in {total_elapsed:.2f}s, returning ID: {intent_id} ==========")
            return intent_id
        else:
            print(f"[WARNING] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Could not extract intent ID from turtle data")
            print(f"[WARNING] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Searching for pattern 'data5g:I' in data...")
            if 'data5g:I' in intent_data:
                print(f"[WARNING] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] Found 'data5g:I' in data, but regex didn't match")
                # Try to find any I followed by hex
                all_matches = re.findall(r'data5g:I([a-f0-9]+)', intent_data)
                print(f"[WARNING] [GraphDB] [{time.strftime('%Y-%m-%d %H:%M:%S')}] All matches found: {all_matches}")
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
            PREFIX imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/>
            
            CONSTRUCT {{
                ?s ?p ?o .
            }}
            WHERE {{
                ?s ?p ?o .
                <http://5g4data.eu/5g4data#I{intent_id}> (^!rdf:type|!rdf:type)* ?s .
                FILTER(?p != rdf:type || ?o != rdf:List)
            }}
            """
            
            headers = {
                "Accept": "text/turtle",
                "Content-Type": "application/sparql-query"
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.repository}",
                data=construct_query.encode("utf-8"),
                headers=headers,
                timeout=30
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
            g.bind("imo", Namespace("http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/"))
            
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
            headers=headers,
            timeout=30
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
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        return response.text

    def delete_intent(self, intent_id: str):
        """Delete a specific intent and its associated file"""
        try:
            # Delete the file if it exists
            file_path = os.path.join(self.intents_dir, f"{intent_id}.ttl")
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
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            
            return response.text
            
        except requests.exceptions.RequestException as e:
            print(f"Error deleting intent: {str(e)}")
            raise Exception(f"Failed to delete intent: {str(e)}")
