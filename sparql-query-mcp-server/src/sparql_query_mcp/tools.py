"""SPARQL query tools for SPARQL Query MCP Server."""

from __future__ import annotations

import json
import logging
import os
import requests
from pathlib import Path
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
        returned in the specified format. Missing prefix declarations will be automatically
        added before execution.
        
        Args:
            query: The SPARQL query to execute
            format: Response format - json (default), xml, csv, or tsv
            timeout: Query timeout in seconds (1-300, default 30)
            
        Returns:
            Dictionary containing query results, execution status, and metadata
        """
        try:
            logger.info(f"Executing SPARQL query with format: {format}")
            
            # Validate and fix SPARQL query prefix declarations
            import re
            
            # Extract used prefixes from the query
            used_prefixes = set()
            for line in query.split('\n'):
                if ':' in line and not line.strip().startswith('#'):
                    # Find prefix usage patterns like icm:Intent, data5g:NetworkExpectation
                    matches = re.findall(r'(\w+):', line)
                    used_prefixes.update(matches)
            
            # Check if all used prefixes are declared
            declared_prefixes = set()
            for line in query.split('\n'):
                if line.strip().startswith('PREFIX') or line.strip().startswith('@prefix'):
                    prefix_name = line.split()[1].rstrip(':')
                    declared_prefixes.add(prefix_name)
            
            missing_prefixes = used_prefixes - declared_prefixes
            if missing_prefixes:
                # Add missing prefix declarations
                prefix_declarations = []
                prefix_map = {
                    'icm': 'http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/',
                    'imo': 'http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/',
                    'met': 'http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/',
                    'log': 'http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/',
                    'data5g': 'http://5g4data.eu/5g4data#',
                    'quan': 'http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/',
                    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
                    'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
                    'xsd': 'http://www.w3.org/2001/XMLSchema#',
                    'dct': 'http://purl.org/dc/terms/',
                    'geo': 'http://www.opengis.net/ont/geosparql#',
                    'set': 'http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/'
                }
                
                for prefix in missing_prefixes:
                    if prefix in prefix_map:
                        prefix_declarations.append(f"PREFIX {prefix}: <{prefix_map[prefix]}>")
                
                if prefix_declarations:
                    # Insert prefix declarations at the beginning
                    lines = query.split('\n')
                    insert_pos = 0
                    for i, line in enumerate(lines):
                        if line.strip().startswith('PREFIX') or line.strip().startswith('@prefix'):
                            insert_pos = i + 1
                        elif line.strip() and not line.strip().startswith('#'):
                            break
                    
                    lines[insert_pos:insert_pos] = prefix_declarations + ['']
                    query = '\n'.join(lines)
                    logger.info(f"Auto-fixed missing prefixes: {', '.join(missing_prefixes)}")
            
            response = client.execute_query(query, format, timeout)
            
            if response.success:
                return {
                    "success": True,
                    "results": response.results,
                    "query": response.query,
                    "execution_time_ms": response.execution_time_ms,
                    "format": format,
                    "repository": config.repository_id,
                    "endpoint": client.endpoint_url,
                    "prefixes_added": list(missing_prefixes) if missing_prefixes else []
                }
            else:
                return {
                    "success": False,
                    "error": response.error,
                    "query": response.query,
                    "execution_time_ms": response.execution_time_ms,
                    "repository": config.repository_id,
                    "endpoint": client.endpoint_url,
                    "prefixes_added": list(missing_prefixes) if missing_prefixes else []
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
        """System prompt for IntentDialogue agent."""
        # Read system prompt from file
        prompt_file = Path(__file__).parent.parent.parent / "system_prompt.txt"
        
        try:
            with open(prompt_file, 'r', encoding='utf-8') as f:
                prompt_content = f.read().strip()
            
            logger.info(f"Loaded system prompt from {prompt_file}")
            return [{"role": "system", "content": prompt_content}]
            
        except FileNotFoundError:
            logger.error(f"System prompt file not found: {prompt_file}")
            raise FileNotFoundError(f"System prompt file not found: {prompt_file}")
        except Exception as e:
            logger.error(f"Error reading system prompt file: {e}")
            raise RuntimeError(f"Error reading system prompt file: {e}")
    
    @mcp.tool
    def get_intent_conditions_for_dashboard(intent_id: str) -> Dict[str, Any]:
        """Get all conditions for an intent to use in Grafana dashboard.
        
        This tool automatically drills down from an intent ID to find all its conditions,
        which is useful for opening Grafana dashboards that need condition metrics.
        
        Args:
            intent_id: The intent ID (e.g., "I113c0e2863f942b4a6b304242f80465f")
            
        Returns:
            Dictionary containing intent_id, condition_ids, and condition_descriptions
        """
        try:
            # Validate intent_id format
            if not intent_id.startswith('I'):
                return {
                    "success": False,
                    "error": f"Invalid intent_id '{intent_id}'. Intent IDs should start with 'I', not '{intent_id[:2]}'. Did you accidentally use an expectation ID instead?",
                    "intent_id": intent_id,
                    "condition_ids": [],
                    "condition_descriptions": []
                }
            
            # Two-stage approach: First get expectations, then get conditions for each expectation
            # Stage 1: Get only Network (NE) and Deployment (DE) expectations for the intent
            expectations_query = f"""
            PREFIX data5g: <http://5g4data.eu/5g4data#>
            PREFIX dct: <http://purl.org/dc/terms/>
            PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
            PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
            
            SELECT ?expectation ?expectation_id ?description WHERE {{
                data5g:{intent_id} log:allOf ?expectation .
                BIND(REPLACE(STR(?expectation), "http://5g4data.eu/5g4data#", "") AS ?expectation_id)
                ?expectation a icm:Expectation ;
                             dct:description ?description .
                
                # Filter to only include Network (NE) and Deployment (DE) expectations
                FILTER(STRSTARTS(?expectation_id, "NE") || STRSTARTS(?expectation_id, "DE"))
            }}
            ORDER BY ?expectation_id
            """
            
            logger.info(f"Executing Stage 1: Getting Network (NE) and Deployment (DE) expectations for intent: {intent_id}")
            
            # Execute query and get raw JSON response
            try:
                import requests
                import time
                
                start_time = time.time()
                response = requests.post(
                    client.endpoint_url,
                    data={"query": expectations_query},
                    auth=client.auth,
                    headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/sparql-results+json'},
                    timeout=30
                )
                response.raise_for_status()
                execution_time = int((time.time() - start_time) * 1000)
                
                # Parse the raw JSON response
                expectations_data = response.json()
                expectation_bindings = expectations_data.get("results", {}).get("bindings", [])
                
                logger.info(f"Successfully parsed {len(expectation_bindings)} expectations")
                
            except Exception as e:
                logger.error(f"Failed to execute Stage 1 query: {e}")
                return {
                    "success": False,
                    "error": f"Stage 1 query failed: {str(e)}",
                    "intent_id": intent_id,
                    "condition_ids": [],
                    "condition_descriptions": []
                }
            
            if not expectation_bindings:
                return {
                    "success": True,
                    "intent_id": intent_id,
                    "condition_ids": [],
                    "condition_descriptions": [],
                    "expectation_count": 0,
                    "condition_count": 0,
                    "message": f"No Network (NE) or Deployment (DE) expectations found for intent {intent_id}"
                }
            
            logger.info(f"Found {len(expectation_bindings)} Network/Deployment expectations for intent {intent_id}")
            
            # Stage 2: Get conditions for each expectation
            all_condition_ids = []
            all_condition_descriptions = []
            
            for expectation_binding in expectation_bindings:
                expectation_id = expectation_binding.get("expectation_id", {}).get("value", "")
                expectation_description = expectation_binding.get("description", {}).get("value", "")
                
                if not expectation_id:
                    continue
                
                # Query conditions for this expectation using direct HTTP request
                conditions_query = f"""
                PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
                PREFIX dct: <http://purl.org/dc/terms/>
                PREFIX data5g: <http://5g4data.eu/5g4data#>
                PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
                
                SELECT ?condition ?condition_id ?description WHERE {{
                    data5g:{expectation_id} log:allOf ?condition .
                    BIND(REPLACE(STR(?condition), "http://5g4data.eu/5g4data#", "") AS ?condition_id)
                    ?condition a icm:Condition ;
                               dct:description ?description .
                }}
                ORDER BY ?condition_id
                """
                
                logger.info(f"Executing Stage 2: Getting conditions for expectation: {expectation_id}")
                
                try:
                    # Execute query directly to get raw JSON
                    conditions_response = requests.post(
                        client.endpoint_url,
                        data={"query": conditions_query},
                        auth=client.auth,
                        headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/sparql-results+json'},
                        timeout=30
                    )
                    conditions_response.raise_for_status()
                    
                    # Parse the raw JSON response
                    conditions_data = conditions_response.json()
                    condition_bindings = conditions_data.get("results", {}).get("bindings", [])
                    
                    for condition_binding in condition_bindings:
                        condition_id = condition_binding.get("condition_id", {}).get("value", "")
                        condition_description = condition_binding.get("description", {}).get("value", "")
                        
                        if condition_id and condition_id not in all_condition_ids:
                            all_condition_ids.append(condition_id)
                            all_condition_descriptions.append(condition_description)
                            
                except Exception as e:
                    logger.warning(f"Failed to get conditions for expectation {expectation_id}: {e}")
            
            logger.info(f"Found {len(all_condition_ids)} total conditions for intent {intent_id}")
            
            return {
                "success": True,
                "intent_id": intent_id,
                "condition_ids": all_condition_ids,
                "condition_descriptions": all_condition_descriptions,
                "expectation_count": len(expectation_bindings),
                "condition_count": len(all_condition_ids),
                "query_execution_time_ms": execution_time
            }
                
        except json.JSONDecodeError as e:
                logger.error(f"Failed to parse expectations results: {e}")
                return {
                    "success": False,
                    "error": f"Failed to parse expectations results: {str(e)}",
                    "intent_id": intent_id,
                    "condition_ids": [],
                    "condition_descriptions": []
                }
                
        except Exception as e:
            logger.exception(f"Error in get_intent_conditions_for_dashboard: {e}")
            return {
                "success": False,
                "error": f"Unexpected error: {str(e)}",
                "intent_id": intent_id,
                "condition_ids": [],
                "condition_descriptions": []
            }

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

