"""SPARQL query tools for SPARQL Query MCP Server."""

from __future__ import annotations

import json
import logging
import os
import requests
from typing import Any, Dict, List, Optional, Annotated
from urllib.parse import urljoin

from fastmcp import FastMCP
from pydantic import BaseModel, Field

# Configure logging
logger = logging.getLogger(__name__)


class GraphDBConfig(BaseModel):
    """Configuration for GraphDB connection."""
    url: str = Field(description="GraphDB base URL")
    repository_id: str = Field(description="Repository ID")
    username: Optional[str] = Field(default=None, description="Username for authentication")
    password: Optional[str] = Field(default=None, description="Password for authentication")


class SPARQLQueryRequest(BaseModel):
    """Request model for SPARQL queries."""
    query: str = Field(description="SPARQL query to execute")
    format: Optional[str] = Field(default="json", description="Response format (json, xml, csv, tsv)")
    timeout: Optional[int] = Field(default=30, description="Query timeout in seconds")


class SPARQLQueryResponse(BaseModel):
    """Response model for SPARQL queries."""
    success: bool = Field(description="Whether the query executed successfully")
    results: Optional[str] = Field(default=None, description="Query results")
    error: Optional[str] = Field(default=None, description="Error message if query failed")
    query: str = Field(description="The executed query")
    execution_time_ms: Optional[int] = Field(default=None, description="Query execution time in milliseconds")


class GraphDBClient:
    """Client for executing SPARQL queries against GraphDB."""
    
    def __init__(self, config: GraphDBConfig):
        """Initialize the GraphDB client."""
        self.config = config
        self.auth = None
        
        if config.username and config.password:
            self.auth = (config.username, config.password)
        
        # Construct the SPARQL endpoint URL
        self.endpoint_url = f"{config.url.rstrip('/')}/repositories/{config.repository_id}"
        
        logger.info(f"Initialized GraphDB client for {self.endpoint_url}")
    
    def execute_query(self, query: str, format: str = "json", timeout: int = 30) -> SPARQLQueryResponse:
        """Execute a SPARQL query against GraphDB."""
        import time
        start_time = time.time()
        
        # Check if debug mode is enabled
        debug_mode = os.getenv("SPARQL_DEBUG", "false").lower() == "true"
        
        try:
            if debug_mode:
                logger.info("=" * 80)
                logger.info("SPARQL QUERY DEBUG")
                logger.info("=" * 80)
                logger.info(f"Endpoint URL: {self.endpoint_url}")
                logger.info(f"Format: {format}")
                logger.info(f"Timeout: {timeout}s")
                logger.info(f"Authentication: {'Yes' if self.auth else 'No'}")
                logger.info("-" * 80)
                logger.info("QUERY:")
                logger.info(query)
                logger.info("-" * 80)
            else:
                logger.debug(f"Executing SPARQL query: {query[:100]}...")
            
            # Set appropriate headers based on format
            headers = {
                "Content-Type": "application/x-www-form-urlencoded"
            }
            
            if format == "json":
                headers["Accept"] = "application/sparql-results+json"
            elif format == "xml":
                headers["Accept"] = "application/sparql-results+xml"
            elif format == "csv":
                headers["Accept"] = "text/csv"
            elif format == "tsv":
                headers["Accept"] = "text/tab-separated-values"
            else:
                headers["Accept"] = "application/sparql-results+json"
            
            if debug_mode:
                logger.info(f"Request Headers: {headers}")
            
            # Execute the query
            response = requests.post(
                self.endpoint_url,
                data={"query": query},
                auth=self.auth,
                headers=headers,
                timeout=timeout
            )
            response.raise_for_status()
            
            execution_time = int((time.time() - start_time) * 1000)
            
            if debug_mode:
                logger.info(f"Response Status: {response.status_code}")
                logger.info(f"Response Headers: {dict(response.headers)}")
                logger.info(f"Execution Time: {execution_time}ms")
                logger.info("-" * 80)
            
            # Process the response based on format
            if format == "json":
                try:
                    json_data = response.json()
                    formatted_results = self._format_json_results(json_data)
                    
                    if debug_mode:
                        logger.info("RAW JSON RESPONSE:")
                        logger.info(json.dumps(json_data, indent=2))
                        logger.info("-" * 80)
                        logger.info("FORMATTED RESULTS:")
                        logger.info(formatted_results)
                        logger.info("=" * 80)
                    
                    return SPARQLQueryResponse(
                        success=True,
                        results=formatted_results,
                        query=query,
                        execution_time_ms=execution_time
                    )
                except ValueError:
                    # If not JSON, return raw text
                    if debug_mode:
                        logger.info("RAW TEXT RESPONSE:")
                        logger.info(response.text)
                        logger.info("=" * 80)
                    
                    return SPARQLQueryResponse(
                        success=True,
                        results=response.text,
                        query=query,
                        execution_time_ms=execution_time
                    )
            else:
                if debug_mode:
                    logger.info("RAW RESPONSE:")
                    logger.info(response.text)
                    logger.info("=" * 80)
                
                return SPARQLQueryResponse(
                    success=True,
                    results=response.text,
                    query=query,
                    execution_time_ms=execution_time
                )
                
        except requests.exceptions.RequestException as e:
            execution_time = int((time.time() - start_time) * 1000)
            logger.error(f"GraphDB request failed: {e}")
            
            if debug_mode:
                logger.error("=" * 80)
                logger.error("QUERY EXECUTION FAILED")
                logger.error("=" * 80)
                logger.error(f"Error: {str(e)}")
                logger.error(f"Execution Time: {execution_time}ms")
                logger.error("=" * 80)
            
            return SPARQLQueryResponse(
                success=False,
                error=f"GraphDB request failed: {str(e)}",
                query=query,
                execution_time_ms=execution_time
            )
        except Exception as e:
            execution_time = int((time.time() - start_time) * 1000)
            logger.error(f"Unexpected error executing SPARQL query: {e}")
            
            if debug_mode:
                logger.error("=" * 80)
                logger.error("UNEXPECTED ERROR")
                logger.error("=" * 80)
                logger.error(f"Error: {str(e)}")
                logger.error(f"Execution Time: {execution_time}ms")
                logger.error("=" * 80)
            
            return SPARQLQueryResponse(
                success=False,
                error=f"Unexpected error: {str(e)}",
                query=query,
                execution_time_ms=execution_time
            )
    
    def _format_json_results(self, json_data: Dict[str, Any]) -> str:
        """Format SPARQL JSON results into a readable table."""
        try:
            if "results" in json_data and "bindings" in json_data["results"]:
                bindings = json_data["results"]["bindings"]
                if not bindings:
                    return "No results found."
                
                # Get variable names from head
                vars_list = json_data["head"].get("vars", [])
                if vars_list:
                    # Create header
                    header = " | ".join(vars_list)
                    separator = " | ".join(["-" * len(var) for var in vars_list])
                    result_lines = [header, separator]
                    
                    # Add data rows
                    for binding in bindings:
                        row = []
                        for var in vars_list:
                            value = binding.get(var, {}).get("value", "")
                            row.append(value)
                        result_lines.append(" | ".join(row))
                    
                    return "\n".join(result_lines)
                else:
                    return "Query executed successfully."
            else:
                return json.dumps(json_data, indent=2)
        except Exception as e:
            logger.warning(f"Error formatting JSON results: {e}")
            return json.dumps(json_data, indent=2)


def load_config_from_env() -> GraphDBConfig:
    """Load GraphDB configuration from environment variables."""
    return GraphDBConfig(
        url=os.getenv("GRAPHDB_URL", "http://start5g-1.cs.uit.no:7200"),
        repository_id=os.getenv("GRAPHDB_REPOSITORY_ID", "intents_and_intent_reports"),
        username=os.getenv("GRAPHDB_USERNAME"),
        password=os.getenv("GRAPHDB_PASSWORD")
    )


def register_sparql_tools(mcp: FastMCP) -> None:
    """Register SPARQL query tools."""
    
    # Load configuration
    config = load_config_from_env()
    client = GraphDBClient(config)
    
    @mcp.tool
    def execute_sparql_query(
        query: Annotated[str, Field(description="SPARQL query to execute")],
        format: Annotated[str, Field(description="Response format (json, xml, csv, tsv)", examples=["json", "xml", "csv", "tsv"])] = "json",
        timeout: Annotated[int, Field(description="Query timeout in seconds", ge=1, le=300)] = 30
    ) -> Dict[str, Any]:
        """Execute a SPARQL query against the configured GraphDB repository.
        
        This tool allows you to execute SPARQL queries against the GraphDB knowledge graph.
        The query will be executed against the configured repository and results will be
        returned in the specified format.
        
        Args:
            query: The SPARQL query to execute
            format: Response format - json (default), xml, csv, or tsv
            timeout: Query timeout in seconds (1-300, default 30)
            
        Returns:
            Dictionary containing query results, execution status, and metadata
        """
        try:
            logger.info(f"Executing SPARQL query with format: {format}")
            
            response = client.execute_query(query, format, timeout)
            
            if response.success:
                return {
                    "success": True,
                    "results": response.results,
                    "query": response.query,
                    "execution_time_ms": response.execution_time_ms,
                    "format": format,
                    "repository": config.repository_id,
                    "endpoint": client.endpoint_url
                }
            else:
                return {
                    "success": False,
                    "error": response.error,
                    "query": response.query,
                    "execution_time_ms": response.execution_time_ms,
                    "repository": config.repository_id,
                    "endpoint": client.endpoint_url
                }
                
        except Exception as e:
            logger.exception(f"Error in execute_sparql_query tool: {e}")
            return {
                "success": False,
                "error": f"Tool error: {str(e)}",
                "query": query,
                "repository": config.repository_id,
                "endpoint": client.endpoint_url
            }
    
    @mcp.tool
    def get_graphdb_info() -> Dict[str, Any]:
        """Get information about the configured GraphDB connection.
        
        Returns:
            Dictionary containing GraphDB connection details and status
        """
        try:
            # Test connection with a simple query
            test_query = "SELECT (COUNT(*) AS ?count) WHERE { ?s ?p ?o }"
            response = client.execute_query(test_query, timeout=10)
            
            return {
                "graphdb_url": config.url,
                "repository_id": config.repository_id,
                "endpoint_url": client.endpoint_url,
                "authentication": "configured" if config.username else "none",
                "connection_status": "connected" if response.success else "error",
                "test_query_result": response.results if response.success else response.error,
                "test_execution_time_ms": response.execution_time_ms
            }
            
        except Exception as e:
            logger.exception(f"Error in get_graphdb_info tool: {e}")
            return {
                "graphdb_url": config.url,
                "repository_id": config.repository_id,
                "endpoint_url": client.endpoint_url,
                "authentication": "configured" if config.username else "none",
                "connection_status": "error",
                "error": str(e)
            }
    
    @mcp.tool
    def validate_sparql_query(
        query: Annotated[str, Field(description="SPARQL query to validate")]
    ) -> Dict[str, Any]:
        """Validate a SPARQL query syntax without executing it.
        
        This tool performs basic SPARQL syntax validation by attempting to parse
        the query structure. Note that this is a basic validation and doesn't
        check against the actual schema.
        
        Args:
            query: The SPARQL query to validate
            
        Returns:
            Dictionary containing validation results and suggestions
        """
        try:
            query_lower = query.lower().strip()
            
            # Basic syntax checks
            validation_results = {
                "valid": True,
                "warnings": [],
                "suggestions": []
            }
            
            # Check for basic SPARQL keywords
            if not any(keyword in query_lower for keyword in ["select", "ask", "construct", "describe"]):
                validation_results["valid"] = False
                validation_results["warnings"].append("Query must contain a SPARQL verb (SELECT, ASK, CONSTRUCT, or DESCRIBE)")
            
            # Check for balanced braces
            open_braces = query.count("{")
            close_braces = query.count("}")
            if open_braces != close_braces:
                validation_results["valid"] = False
                validation_results["warnings"].append(f"Unbalanced braces: {open_braces} open, {close_braces} close")
            
            # Check for common prefixes
            if "prefix" not in query_lower and ":" in query:
                validation_results["suggestions"].append("Consider adding PREFIX declarations for namespaced terms")
            
            # Check for common ontology prefixes
            common_prefixes = ["icm:", "imo:", "met:", "data5g:", "rdf:", "rdfs:"]
            used_prefixes = [prefix for prefix in common_prefixes if prefix in query]
            if used_prefixes:
                validation_results["suggestions"].append(f"Query uses prefixes: {', '.join(used_prefixes)}")
            
            # Check query length
            if len(query) > 10000:
                validation_results["warnings"].append("Query is very long - consider breaking it into smaller parts")
            
            return {
                "query": query,
                "validation": validation_results,
                "query_length": len(query),
                "estimated_complexity": "high" if len(query) > 1000 else "medium" if len(query) > 200 else "low"
            }
            
        except Exception as e:
            logger.exception(f"Error in validate_sparql_query tool: {e}")
            return {
                "query": query,
                "validation": {
                    "valid": False,
                    "warnings": [f"Validation error: {str(e)}"],
                    "suggestions": []
                },
                "error": str(e)
            }
    
    @mcp.tool
    def get_ontology_info() -> Dict[str, Any]:
        """Get information about the ontology schema in the GraphDB repository.
        
        Returns:
            Dictionary containing ontology prefixes, classes, and properties
        """
        try:
            # Query for prefixes
            prefixes_query = """
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
            SELECT DISTINCT ?prefix ?namespace WHERE {
                ?s ?p ?o .
                FILTER(STRSTARTS(STR(?s), "http://"))
                BIND(REPLACE(STR(?s), "^(https?://[^/]+/[^#]*)#?.*$", "$1") AS ?namespace)
                BIND(REPLACE(?namespace, ".*/([^/]+)$", "$1") AS ?prefix)
            }
            ORDER BY ?namespace
            LIMIT 20
            """
            
            prefixes_response = client.execute_query(prefixes_query)
            
            # Query for classes
            classes_query = """
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
            SELECT DISTINCT ?class ?label WHERE {
                ?class a rdfs:Class .
                OPTIONAL { ?class rdfs:label ?label }
            }
            ORDER BY ?class
            LIMIT 50
            """
            
            classes_response = client.execute_query(classes_query)
            
            # Query for properties
            properties_query = """
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
            SELECT DISTINCT ?property ?label WHERE {
                ?property a rdf:Property .
                OPTIONAL { ?property rdfs:label ?label }
            }
            ORDER BY ?property
            LIMIT 50
            """
            
            properties_response = client.execute_query(properties_query)
            
            return {
                "repository": config.repository_id,
                "prefixes": prefixes_response.results if prefixes_response.success else "Error retrieving prefixes",
                "classes": classes_response.results if classes_response.success else "Error retrieving classes",
                "properties": properties_response.results if properties_response.success else "Error retrieving properties",
                "queries_executed": 3,
                "status": "success" if all(r.success for r in [prefixes_response, classes_response, properties_response]) else "partial"
            }
            
        except Exception as e:
            logger.exception(f"Error in get_ontology_info tool: {e}")
            return {
                "repository": config.repository_id,
                "error": str(e),
                "status": "error"
            }
    
    @mcp.tool
    def health_check() -> Dict[str, Any]:
        """Health check endpoint for monitoring server status.
        
        Returns:
            Dictionary containing server health status and GraphDB connectivity
        """
        try:
            # Test GraphDB connection
            test_query = "SELECT (COUNT(*) AS ?total_triples) WHERE { ?s ?p ?o }"
            response = client.execute_query(test_query, timeout=10)
            
            return {
                "status": "healthy" if response.success else "unhealthy",
                "timestamp": "2024-01-01T00:00:00Z",
                "services": {
                    "mcp_server": "operational",
                    "graphdb_connection": "connected" if response.success else "error"
                },
                "graphdb_info": {
                    "url": config.url,
                    "repository": config.repository_id,
                    "endpoint": client.endpoint_url,
                    "test_query_success": response.success,
                    "test_execution_time_ms": response.execution_time_ms
                },
                "test_results": response.results if response.success else response.error
            }
            
        except Exception as e:
            logger.exception(f"Error in health_check tool: {e}")
            return {
                "status": "unhealthy",
                "timestamp": "2024-01-01T00:00:00Z",
                "error": str(e),
                "services": {
                    "mcp_server": "operational",
                    "graphdb_connection": "error"
                }
            }
    
    @mcp.prompt(name="sparql_system_prompt")
    def sparql_query_initial_prompt() -> List[Dict[str, str]]:
        """System prompt for SPARQL query assistance."""
        prompt = (
            "You are a SPARQL query expert assistant for GraphDB knowledge graphs. "
            "You help users write and execute SPARQL queries against the configured GraphDB repository.\n\n"
            "Your capabilities:\n"
            "1) Help users write SPARQL queries for data retrieval\n"
            "2) Validate SPARQL query syntax\n"
            "3) Execute queries and format results\n"
            "4) Provide guidance on ontology structure and prefixes\n\n"
            "Available tools:\n"
            "- execute_sparql_query: Execute SPARQL queries against GraphDB\n"
            "- validate_sparql_query: Validate SPARQL syntax\n"
            "- get_graphdb_info: Get connection and repository information\n"
            "- get_ontology_info: Get ontology schema information\n"
            "- health_check: Check server and GraphDB status\n\n"
            "Common SPARQL patterns:\n"
            "- SELECT queries for data retrieval\n"
            "- COUNT queries for counting resources\n"
            "- FILTER for conditional queries\n"
            "- OPTIONAL for optional patterns\n"
            "- ORDER BY for sorting results\n"
            "- LIMIT for result pagination\n\n"
            "Always provide clear explanations of query results and suggest optimizations when appropriate."
        )
        return [{"role": "system", "content": prompt}]
    
    @mcp.prompt(name="sparql_welcome")
    def sparql_welcome_prompt() -> List[Dict[str, str]]:
        """Welcome prompt for SPARQL query assistance."""
        content = (
            "Hi! I'm your SPARQL Query Assistant. I can help you explore and query "
            "your GraphDB knowledge graph using SPARQL.\n\n"
            "I can help you with:\n"
            "• **Writing SPARQL queries** for data retrieval\n"
            "• **Validating query syntax** before execution\n"
            "• **Executing queries** against your GraphDB repository\n"
            "• **Understanding ontology structure** and available classes/properties\n"
            "• **Optimizing queries** for better performance\n\n"
            "Just tell me what you want to find - for example:\n"
            "• 'How many intents are in the database?'\n"
            "• 'Show me all network expectations with latency requirements'\n"
            "• 'Find observations related to bandwidth conditions'\n"
            "• 'What classes and properties are available in the ontology?'\n\n"
            "I'll help you write the appropriate SPARQL query and execute it!"
        )
        return [{"role": "assistant", "content": content}]
