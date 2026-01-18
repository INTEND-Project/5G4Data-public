#!/usr/bin/env python3
"""
Script to parse Chart.yaml and values.yaml files and insert workload information
into a GraphDB named graph using SPARQL INSERT DATA.
"""

import argparse
import yaml
import requests
import sys
import uuid
from typing import Dict, List, Any, Optional, Tuple


def parse_chart_yaml(file_path: str) -> Dict[str, Any]:
    """Parse Chart.yaml file and return all fields except icon."""
    try:
        with open(file_path, 'r') as f:
            chart_data = yaml.safe_load(f)
        
        # Remove icon if present
        if 'icon' in chart_data:
            del chart_data['icon']
        
        return chart_data
    except FileNotFoundError:
        print(f"Error: Chart.yaml file not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    except yaml.YAMLError as e:
        print(f"Error parsing Chart.yaml: {e}", file=sys.stderr)
        sys.exit(1)


def parse_values_yaml(file_path: str) -> Dict[str, Any]:
    """Parse values.yaml file and extract intent/objectives information."""
    try:
        with open(file_path, 'r') as f:
            values_data = yaml.safe_load(f)
        
        # Extract intent/objectives
        objectives = []
        if 'intent' in values_data and 'objectives' in values_data['intent']:
            for obj in values_data['intent']['objectives']:
                objective_info = {}
                if 'name' in obj:
                    objective_info['name'] = obj['name']
                if 'tmf-value-hint' in obj:
                    objective_info['tmf-value-hint'] = obj['tmf-value-hint']
                if objective_info:  # Only add if we have at least name or tmf-value-hint
                    objectives.append(objective_info)
        
        return {'objectives': objectives}
    except FileNotFoundError:
        print(f"Error: values.yaml file not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    except yaml.YAMLError as e:
        print(f"Error parsing values.yaml: {e}", file=sys.stderr)
        sys.exit(1)


def escape_sparql_string(value: Any) -> str:
    """Escape a value for use in SPARQL string literal."""
    if value is None:
        return '""'
    
    # Convert to string and escape special characters
    str_value = str(value)
    # Escape backslashes and quotes
    str_value = str_value.replace('\\', '\\\\')
    str_value = str_value.replace('"', '\\"')
    return f'"{str_value}"'


def create_sparql_insert_query(chart_data: Dict[str, Any], values_data: Dict[str, Any], 
                                named_graph_uri: str) -> str:
    """Create a SPARQL INSERT DATA query from the parsed data."""
    
    # Generate a unique identifier for the workload
    workload_uuid = f"WO_{uuid.uuid4().hex}"
    
    # Create a base URI for the workload using data5g namespace
    workload_name = chart_data.get('name', 'unknown')
    base_uri = f"http://5g4data.eu/5g4data#workload/{workload_name}"
    
    # Start building the SPARQL query
    query_parts = [
        "PREFIX data5g: <http://5g4data.eu/5g4data#>",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>",
        "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
        "",
        f"INSERT DATA {{",
        f"  GRAPH <{named_graph_uri}> {{"
    ]
    
    # Build workload properties
    workload_props = []
    workload_props.append(f"    <{base_uri}> rdf:type data5g:Workload")
    
    # Add unique identifier
    workload_props.append(f"      ; data5g:uuid {escape_sparql_string(workload_uuid)}")
    
    # Add Chart.yaml fields (everything except icon)
    if 'apiVersion' in chart_data:
        workload_props.append(f"      ; data5g:apiVersion {escape_sparql_string(chart_data['apiVersion'])}")
    if 'name' in chart_data:
        workload_props.append(f"      ; data5g:name {escape_sparql_string(chart_data['name'])}")
        workload_props.append(f"      ; rdfs:label {escape_sparql_string(chart_data['name'])}")
    if 'description' in chart_data:
        workload_props.append(f"      ; data5g:description {escape_sparql_string(chart_data['description'])}")
    if 'type' in chart_data:
        workload_props.append(f"      ; data5g:type {escape_sparql_string(chart_data['type'])}")
    if 'version' in chart_data:
        workload_props.append(f"      ; data5g:version {escape_sparql_string(chart_data['version'])}")
    if 'appVersion' in chart_data:
        workload_props.append(f"      ; data5g:appVersion {escape_sparql_string(chart_data['appVersion'])}")
    
    # Add objectives from values.yaml
    objectives = values_data.get('objectives', [])
    objective_uris = []
    for idx, obj in enumerate(objectives):
        obj_uri = f"{base_uri}/objective/{idx}"
        objective_uris.append(obj_uri)
        
        # Add objective details
        query_parts.append(f"    <{obj_uri}> rdf:type data5g:Objective")
        if 'name' in obj:
            query_parts.append(f"      ; data5g:name {escape_sparql_string(obj['name'])}")
        if 'tmf-value-hint' in obj:
            query_parts.append(f"      ; data5g:tmfValueHint {escape_sparql_string(obj['tmf-value-hint'])}")
        query_parts.append(f"      ; data5g:belongsToWorkload <{base_uri}> .")
        query_parts.append("")
    
    # Add hasObjective links from workload to objectives
    for obj_uri in objective_uris:
        workload_props.append(f"      ; data5g:hasObjective <{obj_uri}>")
    
    # Complete workload statement
    workload_props.append(" .")
    query_parts.extend(workload_props)
    query_parts.append("")
    
    # Close the graph and query
    query_parts.append("  }")
    query_parts.append("}")
    
    return "\n".join(query_parts)


def get_repository_endpoint(repository_url: Optional[str] = None) -> Tuple[str, str]:
    """
    Extract repository endpoint and name from repository URL.
    Returns (base_url, repo_name) tuple.
    Default repository name is 'intent_and_intent_reports'.
    """
    DEFAULT_REPO_NAME = "intents_and_intent_reports"
    DEFAULT_BASE_URL = "http://start5g-1.cs.uit.no:7200"
    
    if not repository_url:
        return (DEFAULT_BASE_URL, DEFAULT_REPO_NAME)
    
    if repository_url.startswith('http://') or repository_url.startswith('https://'):
        # Full URL provided
        if '/repositories/' in repository_url:
            base_url = repository_url.split('/repositories/')[0]
            repo_name = repository_url.split('/repositories/')[1].split('/')[0]  # Get just repo name
            return (base_url, repo_name)
        else:
            # Assume it's a named graph URI, use default repository
            return (DEFAULT_BASE_URL, DEFAULT_REPO_NAME)
    else:
        # Assume it's just the repository name
        return (DEFAULT_BASE_URL, repository_url)


def ensure_named_graph_exists(base_url: str, repo_name: str, named_graph_uri: str,
                              username: Optional[str] = None, 
                              password: Optional[str] = None) -> bool:
    """
    Ensure the named graph exists in the repository.
    GraphDB will create the graph automatically when we insert data into it,
    so this function is a placeholder for future graph existence checks if needed.
    """
    # GraphDB automatically creates named graphs when data is inserted into them
    # via SPARQL INSERT DATA with GRAPH clause, so no explicit creation is needed
    return True


def insert_to_graphdb(repository_url: Optional[str], named_graph_uri: str, sparql_query: str, 
                     username: Optional[str] = None, 
                     password: Optional[str] = None) -> bool:
    """Insert data into GraphDB using SPARQL INSERT DATA."""
    
    # Extract repository endpoint
    base_url, repo_name = get_repository_endpoint(repository_url)
    
    # Ensure named graph exists (GraphDB will create it automatically on first insert)
    ensure_named_graph_exists(base_url, repo_name, named_graph_uri, username, password)
    
    # Construct the update endpoint
    update_endpoint = f"{base_url}/repositories/{repo_name}/statements"
    
    # Prepare headers
    headers = {
        "Content-Type": "application/sparql-update",
        "Accept": "application/json"
    }
    
    # Prepare authentication if provided
    auth = None
    if username and password:
        auth = (username, password)
    
    try:
        response = requests.post(
            update_endpoint,
            data=sparql_query,
            headers=headers,
            auth=auth,
            timeout=30
        )
        response.raise_for_status()
        print(f"Successfully inserted data into GraphDB repository: {repo_name}")
        print(f"Repository endpoint: {update_endpoint}")
        print(f"Named graph URI: {named_graph_uri}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error inserting data into GraphDB: {e}", file=sys.stderr)
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}", file=sys.stderr)
        return False


def main():
    """Main function to parse arguments and execute the script."""
    parser = argparse.ArgumentParser(
        description='Parse Chart.yaml and values.yaml files and insert workload information into GraphDB'
    )
    parser.add_argument(
        '--chart', '-c',
        required=True,
        help='Path to Chart.yaml file'
    )
    parser.add_argument(
        '--values', '-v',
        required=True,
        help='Path to values.yaml file'
    )
    parser.add_argument(
        '--repository', '-r',
        required=False,
        default=None,
        help='URL to the repository (e.g., http://localhost:7200/repositories/my-repo or just repo-name). Default: intent_and_intent_reports'
    )
    parser.add_argument(
        '--named-graph', '-g',
        required=False,
        default=None,
        help='URI of the named graph. Default: http://intentproject.eu/telenor/workload'
    )
    parser.add_argument(
        '--username', '-u',
        help='Username for GraphDB authentication (optional)'
    )
    parser.add_argument(
        '--password', '-p',
        help='Password for GraphDB authentication (optional)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Print the SPARQL query without executing it'
    )
    
    args = parser.parse_args()
    
    # Parse the YAML files
    print(f"Parsing Chart.yaml: {args.chart}")
    chart_data = parse_chart_yaml(args.chart)
    
    print(f"Parsing values.yaml: {args.values}")
    values_data = parse_values_yaml(args.values)
    
    # Determine named graph URI (default: http://intentproject.eu/telenor/workload)
    DEFAULT_NAMED_GRAPH = "http://intentproject.eu/telenor/workload"
    named_graph_uri = args.named_graph if args.named_graph else DEFAULT_NAMED_GRAPH
    
    # Get repository info
    base_url, repo_name = get_repository_endpoint(args.repository)
    print(f"Using repository: {repo_name} at {base_url}")
    print(f"Using named graph: {named_graph_uri}")
    
    # Create SPARQL query
    sparql_query = create_sparql_insert_query(chart_data, values_data, named_graph_uri)
    
    if args.dry_run:
        print("\n=== SPARQL Query (dry-run) ===")
        print(sparql_query)
        print("\n=== End of SPARQL Query ===\n")
    else:
        # Insert into GraphDB
        print(f"\nInserting data into GraphDB")
        success = insert_to_graphdb(
            args.repository,
            named_graph_uri,
            sparql_query,
            args.username,
            args.password
        )
        
        if not success:
            sys.exit(1)
    
    print("Done!")


if __name__ == '__main__':
    main()
