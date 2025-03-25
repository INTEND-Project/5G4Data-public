import requests
from rdflib import Graph, URIRef, Literal
import json
import re
import os
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
            
            print("Generated Turtle:", response.text)  # Debug print
            return response.text
            
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