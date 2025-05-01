import requests
from rdflib import Graph, URIRef, Literal, Namespace
import json
import re
import os
from datetime import datetime
from typing import Optional

class IntentReportClient:
    def __init__(self, base_url="http://start5g-1.cs.uit.no:7200", repository="intent-reports"):
        self.base_url = base_url
        self.repository = repository
        self.sparql_endpoint = f"{base_url}/repositories/{repository}/statements"
        self.query_endpoint = f"{base_url}/repositories/{repository}/sparql"
        self.intents_repository = "intents"  # Repository where intents are stored
        self.auth = None  # No authentication by default

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
                ?condition ?cp ?co .
                ?condition dct:description ?desc .
                ?condition quan:minValue ?minValue .
                ?condition quan:maxValue ?maxValue .
                ?condition quan:unit ?unit .
                ?condition icm:valuesOfTargetProperty ?targetProp .
            }}
            WHERE {{
                ?s ?p ?o .
                <http://5g4data.eu/5g4data#I{intent_id}> (^!rdf:type|!rdf:type)* ?s .
                
                # Get all condition data
                ?condition a icm:Condition ;
                    ?cp ?co .
                <http://5g4data.eu/5g4data#I{intent_id}> (^!rdf:type|!rdf:type)* ?condition .
                
                # Get specific condition properties
                OPTIONAL {{ ?condition dct:description ?desc }}
                OPTIONAL {{ ?condition quan:minValue ?minValue }}
                OPTIONAL {{ ?condition quan:maxValue ?maxValue }}
                OPTIONAL {{ ?condition quan:unit ?unit }}
                OPTIONAL {{ ?condition icm:valuesOfTargetProperty ?targetProp }}
            }}
            """
            
            headers = {
                "Accept": "text/turtle",
                "Content-Type": "application/sparql-query"
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.intents_repository}",
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


    def get_intents(self):
        """Get a list of all intents from the intents repository"""
        print(f"Fetching intents from repository: {self.intents_repository}")  # Debug log
        query = """
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
        PREFIX data5g: <http://5g4data.eu/5g4data#>
        PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
        
        SELECT DISTINCT ?intent ?id ?type
        WHERE {
            ?intent a icm:Intent ;
                log:allOf ?extype .
            ?extype icm:target ?target .
            BIND(REPLACE(STR(?intent), ".*#I", "") AS ?id)
            BIND(IF(?target = data5g:network-slice, "Network",
                    IF(?target = data5g:deployment, "Workload",
                    IF(?target = data5g:network-slice && EXISTS { ?intent log:allOf data5g:RE2 }, "Combined", "Unknown"))) AS ?type)
        }        ORDER BY ?id
        """
        headers = {
            'Accept': 'application/sparql-results+json',
            'Content-Type': 'application/sparql-query'
        }
        try:
            response = requests.post(
                f"{self.base_url}/repositories/{self.intents_repository}",
                data=query.encode('utf-8'),
                headers=headers
            )
            print(f"GraphDB response status: {response.status_code}")  # Debug log
            #print(f"GraphDB response: {response.text}")  # Debug log
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Error fetching intents: {str(e)}")  # Debug log
            raise

    def store_intent_report(self, turtle_data):
        """Store an intent report in GraphDB"""
        try:
            # First, check if the repository exists
            if not self.repository_exists("intent-reports"):
                self.create_repository("intent-reports")
            
            # Add the imo prefix to the turtle data if it's not already there
            if "@prefix imo:" not in turtle_data:
                turtle_data = "@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentModelOntology/> .\n" + turtle_data
            
            # Store the turtle data
            response = requests.post(
                f"{self.base_url}/repositories/intent-reports/statements",
                headers={"Content-Type": "application/x-turtle"},
                data=turtle_data,
                auth=self.auth
            )
            
            if response.status_code == 204:
                print(f"Successfully stored intent report in GraphDB")
                return True
            else:
                print(f"Failed to store intent report. Status code: {response.status_code}")
                print(f"Response: {response.text}")
                return False
            
        except Exception as e:
            print(f"Error storing intent report: {str(e)}")
            return False

    def get_last_intent_report(self, intent_id: str) -> Optional[str]:
        """Get the last intent report for a specific intent.
        
        Args:
            intent_id: The ID of the intent
            
        Returns:
            The report content as a string, or None if not found
        """
        try:
            query = f"""
            PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            PREFIX imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentModelOntology/>
            PREFIX dct: <http://purl.org/dc/terms/>
            PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
            
            CONSTRUCT {{
                ?report rdf:type icm:IntentReport ;
                        icm:about data5g:I{intent_id} ;
                        icm:reportNumber ?number ;
                        icm:reportGenerated ?timestamp .
                ?report icm:intentHandlingState ?state .
                ?report icm:reason ?reason .
                ?report imo:handler ?handler .
                ?report imo:owner ?owner .
                
                # Include condition data
                ?condition rdf:type icm:Condition ;
                          dct:description ?desc ;
                          quan:minValue ?minValue ;
                          quan:maxValue ?maxValue ;
                          quan:unit ?unit ;
                          icm:valuesOfTargetProperty ?targetProp .
            }}
            WHERE {{
                ?report rdf:type icm:IntentReport ;
                        icm:about data5g:I{intent_id} ;
                        icm:reportNumber ?number ;
                        icm:reportGenerated ?timestamp .
                OPTIONAL {{ ?report icm:intentHandlingState ?state }}
                OPTIONAL {{ ?report icm:reason ?reason }}
                OPTIONAL {{ ?report imo:handler ?handler }}
                OPTIONAL {{ ?report imo:owner ?owner }}
                
                # Get condition data
                OPTIONAL {{
                    ?condition rdf:type icm:Condition ;
                              dct:description ?desc ;
                              quan:minValue ?minValue ;
                              quan:maxValue ?maxValue ;
                              quan:unit ?unit ;
                              icm:valuesOfTargetProperty ?targetProp .
                    data5g:I{intent_id} (^!rdf:type|!rdf:type)* ?condition .
                }}
            }}
            ORDER BY DESC(?timestamp)
            LIMIT 1
            """
            
            headers = {
                'Accept': 'text/turtle',
                'Content-Type': 'application/sparql-query'
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.repository}",
                data=query.encode('utf-8'),
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
            
        except Exception as e:
            print(f"Error getting last intent report: {str(e)}")
            raise

    def get_highest_intent_report_number(self, intent_id):
        """Get the highest report number for a specific intent"""
        query = f"""
        PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
        PREFIX data5g: <http://5g4data.eu/5g4data#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
        
        SELECT (MAX(xsd:integer(?reportNum)) as ?maxReportNum)
        WHERE {{
            ?report rdf:type icm:IntentReport ;
                    icm:about data5g:I{intent_id} ;
                    icm:reportNumber ?reportNum .
        }}
        """
        headers = {
            'Accept': 'application/sparql-results+json',
            'Content-Type': 'application/sparql-query'
        }
        response = requests.post(
            f"{self.base_url}/repositories/{self.repository}",
            data=query.encode('utf-8'),
            headers=headers
        )
        response.raise_for_status()
        results = response.json()
        if results["results"]["bindings"] and "maxReportNum" in results["results"]["bindings"][0]:
            return int(results["results"]["bindings"][0]["maxReportNum"]["value"])
        return 0

    def repository_exists(self, repo_id):
        """Check if a repository exists"""
        try:
            response = requests.get(
                f"{self.base_url}/rest/repositories",
                headers={"Accept": "application/json"}
            )
            response.raise_for_status()
            repositories = response.json()
            
            # The response is a list of repository IDs
            return repo_id in repositories
        except Exception as e:
            print(f"Error checking if repository exists: {str(e)}")
            return False

    def create_repository(self, repo_id):
        """Create a new repository"""
        try:
            # GraphDB requires a specific config for repository creation
            config = {
                "id": repo_id,
                "type": "free",
                "title": f"{repo_id} Repository",
                "ruleset": "owl-horst-optimized"
            }
            
            response = requests.post(
                f"{self.base_url}/rest/repositories",
                headers={"Content-Type": "application/json"},
                json=config
            )
            
            if response.status_code == 201:
                print(f"Repository {repo_id} created successfully")
                return True
            else:
                print(f"Failed to create repository {repo_id}. Status code: {response.status_code}")
                print(f"Response: {response.text}")
                return False
        except Exception as e:
            print(f"Error creating repository: {str(e)}")
            return False

    def get_intent_report_by_number(self, intent_id: str, report_number: int) -> Optional[str]:
        """Get an intent report by its report number for a specific intent.
        
        Args:
            intent_id: The ID of the intent
            report_number: The report number to retrieve
            
        Returns:
            The report content as a string, or None if not found
        """
        try:
            query = f"""
            PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
            PREFIX imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentModelOntology/>
            
            SELECT ?report ?number ?timestamp ?state ?reason ?handler ?owner
            WHERE {{
                ?report rdf:type icm:IntentReport ;
                        icm:about data5g:I{intent_id} ;
                        icm:reportNumber ?number ;
                        icm:reportGenerated ?timestamp .
                FILTER (?number = "{report_number}"^^xsd:integer)
                OPTIONAL {{ ?report icm:intentHandlingState ?state }}
                OPTIONAL {{ ?report icm:intentUpdateState ?state }}
                OPTIONAL {{ ?report icm:reason ?reason }}
                OPTIONAL {{ ?report imo:handler ?handler }}
                OPTIONAL {{ ?report imo:owner ?owner }}
            }}
            ORDER BY DESC(?timestamp)
            LIMIT 1
            """
            
            headers = {
                'Accept': 'application/sparql-results+json',
                'Content-Type': 'application/sparql-query'
            }
            
            response = requests.post(
                f"{self.base_url}/repositories/{self.repository}",
                data=query.encode('utf-8'),
                headers=headers
            )
            response.raise_for_status()
            
            result = response.json()
            if not result.get('results', {}).get('bindings'):
                return None
                
            # Format the Turtle data with prefixes first
            binding = result['results']['bindings'][0]
            turtle = "@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .\n"
            turtle += "@prefix data5g: <http://5g4data.eu/5g4data#> .\n"
            turtle += "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n"
            turtle += "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n"
            turtle += "@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentModelOntology/> .\n\n"
            
            # Extract the report ID from the URI
            report_uri = binding['report']['value']
            report_id = report_uri.split('/')[-1]
            
            # Add the report data using simplified prefixes
            turtle += f'icm:{report_id} rdf:type icm:IntentReport ;\n'
            turtle += f'    icm:about data5g:I{intent_id} ;\n'
            turtle += f'    icm:reportNumber "{binding["number"]["value"]}"^^xsd:integer ;\n'
            turtle += f'    icm:reportGenerated "{binding["timestamp"]["value"]}"^^xsd:dateTime'
            
            if "state" in binding:
                # Extract just the state name from the full URI
                state_uri = binding["state"]["value"]
                state_name = state_uri.split('/')[-1]
                turtle += f' ;\n    icm:intentHandlingState imo:{state_name}'
            
            if "handler" in binding:
                turtle += f' ;\n    imo:handler "{binding["handler"]["value"]}"'
            
            if "owner" in binding:
                turtle += f' ;\n    imo:owner "{binding["owner"]["value"]}"'
            
            if "reason" in binding:
                turtle += f' ;\n    icm:reason "{binding["reason"]["value"]}"'
            
            turtle += ' .'
            
            return turtle
            
        except Exception as e:
            print(f"Error getting intent report by number: {str(e)}")
            raise 