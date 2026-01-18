#!/usr/bin/env python3
"""
Script to parse polygon files and insert polygon information
into a GraphDB named graph using SPARQL INSERT DATA.
"""

import argparse
import requests
import sys
import re
import shlex
import uuid
from typing import Dict, List, Any, Optional, Tuple


def parse_polygon_file(file_path: str) -> List[Dict[str, str]]:
    """Parse polygon file and return list of polygon entries."""
    polygons = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line_idx, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                
                # Skip header line
                if line.lower() == 'description country polygon':
                    continue
                
                # Use shlex to properly parse quoted strings separated by spaces
                try:
                    parts = shlex.split(line)
                    if len(parts) < 3:
                        print(f"Warning: Skipping line {line_idx} - insufficient columns (expected 3, got {len(parts)}): {line[:100]}...", file=sys.stderr)
                        continue
                    
                    description = parts[0].strip()
                    country = parts[1].strip()
                    polygon = parts[2].strip()
                    
                    # Skip header line if encountered in data
                    if description.lower() == 'description' and country.lower() == 'country' and polygon.lower() == 'polygon':
                        continue
                    
                    if description and country and polygon:
                        polygons.append({
                            'description': description,
                            'country': country,
                            'polygon': polygon
                        })
                except ValueError as e:
                    print(f"Warning: Skipping line {line_idx} - parsing error: {e}", file=sys.stderr)
                    continue
        
        return polygons
    except FileNotFoundError:
        print(f"Error: Polygon file not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error parsing polygon file: {e}", file=sys.stderr)
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


def sanitize_uri_component(text: str) -> str:
    """Sanitize text for use in URI component."""
    # Replace spaces and special chars with underscores
    sanitized = re.sub(r'[^\w\-]', '_', text)
    # Remove multiple consecutive underscores
    sanitized = re.sub(r'_+', '_', sanitized)
    # Remove leading/trailing underscores
    sanitized = sanitized.strip('_')
    return sanitized


def create_sparql_insert_query(polygons: List[Dict[str, str]], named_graph_uri: str) -> str:
    """Create a SPARQL INSERT DATA query from the parsed polygon data."""
    
    # Start building the SPARQL query
    query_parts = [
        "PREFIX data5g: <http://5g4data.eu/5g4data#>",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>",
        "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
        "PREFIX geo: <http://www.opengis.net/ont/geosparql#>",
        "PREFIX geof: <http://www.opengis.net/def/function/geosparql/>",
        "",
        f"INSERT DATA {{",
        f"  GRAPH <{named_graph_uri}> {{"
    ]
    
    # Add each polygon
    for idx, polygon_data in enumerate(polygons):
        description = polygon_data['description']
        country = polygon_data['country']
        polygon_wkt = polygon_data['polygon']
        
        # Generate a unique identifier for the polygon
        polygon_uuid = f"PO_{uuid.uuid4().hex}"
        
        # Create URI for this polygon
        polygon_id = sanitize_uri_component(f"{country}_{description}")
        polygon_uri = f"http://5g4data.eu/5g4data#polygon/{polygon_id}"
        
        # Add polygon resource
        query_parts.append(f"    <{polygon_uri}> rdf:type data5g:Polygon")
        query_parts.append(f"      ; data5g:uuid {escape_sparql_string(polygon_uuid)}")
        query_parts.append(f"      ; rdfs:label {escape_sparql_string(description)}")
        query_parts.append(f"      ; data5g:description {escape_sparql_string(description)}")
        query_parts.append(f"      ; data5g:country {escape_sparql_string(country)}")
        query_parts.append(f"      ; geo:asWKT {escape_sparql_string(polygon_wkt)} .")
        query_parts.append("")
    
    # Close the graph and query
    query_parts.append("  }")
    query_parts.append("}")
    
    return "\n".join(query_parts)


def get_repository_endpoint(repository_url: Optional[str] = None) -> Tuple[str, str]:
    """
    Extract repository endpoint and name from repository URL.
    Returns (base_url, repo_name) tuple.
    Default repository name is 'intents_and_intent_reports'.
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
        description='Parse polygon files and insert polygon information into GraphDB'
    )
    parser.add_argument(
        '--polygons', '-p',
        required=True,
        help='Path to polygon file (tab-separated: Description, Country, Polygon)'
    )
    parser.add_argument(
        '--repository', '-r',
        required=False,
        default=None,
        help='URL to the repository (e.g., http://localhost:7200/repositories/my-repo or just repo-name). Default: intents_and_intent_reports'
    )
    parser.add_argument(
        '--named-graph', '-g',
        required=False,
        default=None,
        help='URI of the named graph. Default: http://intentproject.eu/telenor/polygons'
    )
    parser.add_argument(
        '--username', '-u',
        help='Username for GraphDB authentication (optional)'
    )
    parser.add_argument(
        '--password', '-P',
        dest='password',
        help='Password for GraphDB authentication (optional)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Print the SPARQL query without executing it'
    )
    
    args = parser.parse_args()
    
    # Parse the polygon file
    print(f"Parsing polygon file: {args.polygons}")
    polygons = parse_polygon_file(args.polygons)
    print(f"Found {len(polygons)} polygons")
    
    # Determine named graph URI (default: http://intentproject.eu/telenor/polygons)
    DEFAULT_NAMED_GRAPH = "http://intentproject.eu/telenor/polygons"
    named_graph_uri = args.named_graph if args.named_graph else DEFAULT_NAMED_GRAPH
    
    # Get repository info
    base_url, repo_name = get_repository_endpoint(args.repository)
    print(f"Using repository: {repo_name} at {base_url}")
    print(f"Using named graph: {named_graph_uri}")
    
    # Create SPARQL query
    sparql_query = create_sparql_insert_query(polygons, named_graph_uri)
    
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
