from flask import Flask, jsonify, request
import requests
import json
import os
from datetime import datetime
import logging

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# GraphDB configuration
GRAPHDB_URL = os.environ.get('GRAPHDB_URL', "http://start5g-1.cs.uit.no:7200")
REPOSITORY = os.environ.get('GRAPHDB_REPOSITORY', "intent-reports")  # You may need to adjust this based on your GraphDB setup

def get_metric_query(metric_name):
    """
    Retrieve the SPARQL query for a given metric name from GraphDB
    """
    sparql_query = """
    PREFIX data5g: <http://5g4data.eu/5g4data#>

    SELECT ?object
    FROM NAMED <http://intent-reports-metadata>
    WHERE {
      GRAPH <http://intent-reports-metadata> {
        data5g:%s data5g:hasQuery ?object .
      }
    }
    """ % metric_name
    
    try:
        # Make request to GraphDB
        response = requests.post(
            f"{GRAPHDB_URL}/repositories/{REPOSITORY}",
            headers={
                "Content-Type": "application/sparql-query",
                "Accept": "application/sparql-results+json"
            },
            data=sparql_query
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('results', {}).get('bindings'):
                return result['results']['bindings'][0]['object']['value']
            else:
                logger.warning(f"No query found for metric: {metric_name}")
                return None
        else:
            logger.error(f"GraphDB request failed with status {response.status_code}")
            return None
            
    except Exception as e:
        logger.error(f"Error querying GraphDB: {str(e)}")
        return None

def execute_observation_query(query, start_time=None, end_time=None, step=None):
    """
    Execute the observation query and return the results
    The query is a REST URL that should be executed directly
    Supports time range filtering for Grafana integration
    """
    try:
        # Modify query URL to include time range parameters if provided
        modified_query = query
        if start_time and end_time:
            # Handle different query types
            # Check if this is a Prometheus query (contains :9090 or api/v1/query endpoints)
            is_prometheus_query = (':9090' in query or 'api/v1/query' in query or 'api/v1/query_range' in query)
            
            if is_prometheus_query:
                # For Prometheus range queries, use query_range endpoint
                if 'api/v1/query' in query and 'api/v1/query_range' not in query:
                    # Convert instant query to range query
                    modified_query = query.replace('api/v1/query', 'api/v1/query_range')
                
                # Add time range parameters to the URL
                separator = '&' if '?' in modified_query else '?'
                # Use provided step parameter or default to 60s
                step_param = step if step else '60s'
                logger.info(f"Step parameter debug - provided: '{step}', using: '{step_param}'")
                
                # Ensure step parameter is not empty
                if step_param and step_param.strip():
                    modified_query = f"{modified_query}{separator}start={start_time}&end={end_time}&step={step_param}"
                else:
                    modified_query = f"{modified_query}{separator}start={start_time}&end={end_time}&step=60s"
                
                logger.info(f"Modified Prometheus query with time range and step: {modified_query}")
            else:
                # For other REST endpoints, add time range parameters
                separator = '&' if '?' in query else '?'
                modified_query = f"{query}{separator}start={start_time}&end={end_time}"
                logger.info(f"Modified non-Prometheus query with time range: {modified_query}")
        else:
            logger.info(f"Executing REST query: {query}")
        
        # Check if this is a GraphDB SPARQL endpoint
        if 'repositories' in query and 'query=' in query:
            # This is a GraphDB SPARQL endpoint, request JSON format
            headers = {
                'Accept': 'application/sparql-results+json'
            }
            response = requests.get(modified_query, headers=headers, timeout=30)
        else:
            # Regular REST endpoint
            response = requests.get(modified_query, timeout=30)
        
        if response.status_code == 200:
            # Check content type to determine how to parse
            content_type = response.headers.get('content-type', '')
            
            if 'application/sparql-results+json' in content_type or 'application/json' in content_type:
                # JSON response
                rest_data = response.json()
                logger.info(f"Received JSON response with {len(str(rest_data))} characters")
                if 'prometheus' in modified_query.lower():
                    logger.info(f"Prometheus response structure: {list(rest_data.keys()) if isinstance(rest_data, dict) else 'Not a dict'}")
                return parse_rest_response(rest_data)
            elif 'text/csv' in content_type or query.endswith('.csv'):
                # CSV response
                return parse_csv_response(response.text)
            elif 'application/xml' in content_type or 'text/xml' in content_type:
                # XML response
                return parse_xml_response(response.text)
            else:
                # Try to parse as JSON first, then fallback to CSV
                try:
                    rest_data = response.json()
                    return parse_rest_response(rest_data)
                except:
                    # Assume it's CSV if JSON parsing fails
                    return parse_csv_response(response.text)
        else:
            logger.error(f"REST query failed with status {response.status_code}: {response.text}")
            return None
            
    except Exception as e:
        logger.error(f"Error executing REST query: {str(e)}")
        return None

def parse_rest_response(rest_data):
    """
    Parse REST response and convert to SPARQL-like format for consistency
    """
    try:
        # Convert REST response to SPARQL-like format
        sparql_format = {
            'results': {
                'bindings': []
            }
        }
        
        # Handle different REST response formats
        if isinstance(rest_data, dict):
            if 'data' in rest_data and 'result' in rest_data['data']:
                # Prometheus-like format
                results = rest_data['data']['result']
                for result in results:
                    if 'values' in result:
                        # Matrix format
                        for value_pair in result['values']:
                            timestamp, value = value_pair
                            binding = {
                                'timestamp': {'value': str(timestamp)},
                                'value': {'value': str(value)},
                                'metric': {'value': result.get('metric', {}).get('__name__', 'unknown')}
                            }
                            sparql_format['results']['bindings'].append(binding)
                    elif 'value' in result:
                        # Vector format
                        timestamp, value = result['value']
                        binding = {
                            'timestamp': {'value': str(timestamp)},
                            'value': {'value': str(value)},
                            'metric': {'value': result.get('metric', {}).get('__name__', 'unknown')}
                        }
                        sparql_format['results']['bindings'].append(binding)
            elif 'results' in rest_data and 'bindings' in rest_data['results']:
                # SPARQL JSON results format (GraphDB)
                return rest_data  # Already in the correct format
            elif 'result' in rest_data:
                # Direct result format
                results = rest_data['result']
                for result in results:
                    binding = {
                        'timestamp': {'value': str(result.get('timestamp', ''))},
                        'value': {'value': str(result.get('value', ''))},
                        'metric': {'value': result.get('metric', 'unknown')}
                    }
                    sparql_format['results']['bindings'].append(binding)
            else:
                # Try to parse as array of objects
                if isinstance(rest_data, list):
                    for item in rest_data:
                        binding = {
                            'timestamp': {'value': str(item.get('timestamp', ''))},
                            'value': {'value': str(item.get('value', ''))},
                            'metric': {'value': item.get('metric', 'unknown')}
                        }
                        sparql_format['results']['bindings'].append(binding)
                else:
                    # Fallback: try to extract any numeric values
                    logger.warning(f"Unknown REST response format: {rest_data}")
                    return None
        else:
            logger.error(f"Unexpected REST response format: {rest_data}")
            return None
        
        return sparql_format
            
    except Exception as e:
        logger.error(f"Error parsing REST response: {str(e)}")
        return None

def parse_csv_response(csv_text):
    """
    Parse CSV response and convert to SPARQL-like format
    """
    try:
        import csv
        from io import StringIO
        
        sparql_format = {
            'results': {
                'bindings': []
            }
        }
        
        # Parse CSV
        csv_reader = csv.DictReader(StringIO(csv_text))
        
        for row in csv_reader:
            binding = {}
            for column, value in row.items():
                binding[column] = {'value': value}
            sparql_format['results']['bindings'].append(binding)
        
        return sparql_format
        
    except Exception as e:
        logger.error(f"Error parsing CSV response: {str(e)}")
        return None

def parse_xml_response(xml_text):
    """
    Parse XML response and convert to SPARQL-like format
    """
    try:
        import xml.etree.ElementTree as ET
        
        sparql_format = {
            'results': {
                'bindings': []
            }
        }
        
        # Parse XML
        root = ET.fromstring(xml_text)
        
        # Look for result elements
        for result in root.findall('.//result'):
            binding = {}
            for binding_elem in result.findall('.//binding'):
                name = binding_elem.get('name')
                value_elem = binding_elem.find('.//*')
                if value_elem is not None:
                    value = value_elem.text or ''
                    binding[name] = {'value': value}
            if binding:
                sparql_format['results']['bindings'].append(binding)
        
        return sparql_format
        
    except Exception as e:
        logger.error(f"Error parsing XML response: {str(e)}")
        return None

def format_for_grafana_infinity(sparql_results):
    """
    Format SPARQL results for Grafana Infinity data source
    Returns data in a format that Infinity can parse for timeseries graphs
    """
    if not sparql_results or 'results' not in sparql_results:
        return []
    
    # Extract column names from the SPARQL results
    columns = []
    if sparql_results['results']['bindings']:
        columns = list(sparql_results['results']['bindings'][0].keys())
    
    # Format data for Infinity
    formatted_data = []
    
    for binding in sparql_results['results']['bindings']:
        row = {}
        for column in columns:
            if column in binding:
                value = binding[column]['value']
                # Try to parse as timestamp if it looks like one
                if 'time' in column.lower() or 'date' in column.lower():
                    try:
                        # Handle Unix timestamps (seconds since epoch)
                        if value.isdigit() and len(value) >= 10:
                            # Unix timestamp
                            timestamp = datetime.fromtimestamp(float(value))
                            row[column] = timestamp.isoformat()
                        else:
                            # ISO format timestamp
                            timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
                            row[column] = timestamp.isoformat()
                    except:
                        row[column] = value
                else:
                    row[column] = value
        formatted_data.append(row)
    
    return formatted_data

@app.route('/api/get-metric-reports/<metric_name>', methods=['GET'])
def get_metric_reports(metric_name):
    """
    GET route to retrieve metric reports for a specific metric
    Supports time range parameters for Grafana Infinity integration
    """
    try:
        # Get time range parameters from request
        start_time = request.args.get('start', None)
        end_time = request.args.get('end', None)
        step = request.args.get('step', None)  # Get step parameter for Prometheus queries
        
        # Clean up step parameter - handle empty string case
        if step == '':
            step = None
        
        logger.info(f"Requesting metric reports for: {metric_name}")
        if start_time and end_time:
            logger.info(f"Time range: {start_time} to {end_time}")
            logger.info(f"Step parameter: {step}")
            # Convert timestamps if they're in ISO format
            try:
                if start_time and 'T' in start_time:
                    start_time = str(int(datetime.fromisoformat(start_time.replace('Z', '+00:00')).timestamp()))
                if end_time and 'T' in end_time:
                    end_time = str(int(datetime.fromisoformat(end_time.replace('Z', '+00:00')).timestamp()))
                logger.info(f"Converted timestamps - start: {start_time}, end: {end_time}")
            except Exception as e:
                logger.warning(f"Could not convert timestamps: {e}")
        
        # Get the metric query from GraphDB
        metric_query = get_metric_query(metric_name)
        
        if not metric_query:
            return jsonify({
                'error': f'No query found for metric: {metric_name}',
                'data': []
            }), 404
        
        logger.info(f"Retrieved query for metric {metric_name}: {metric_query}")
        
        # Execute the observation query with time range and step if provided
        observation_results = execute_observation_query(metric_query, start_time, end_time, step)
        
        if not observation_results:
            return jsonify({
                'error': 'Failed to execute REST query. Check the application logs for details.',
                'data': []
            }), 500
        
        # Format results for Grafana Infinity
        formatted_data = format_for_grafana_infinity(observation_results)
        
        # Return data in format suitable for Grafana Infinity
        response_data = {
            'data': formatted_data,
            'meta': {
                'metric_name': metric_name,
                'query': metric_query,
                'start_time': start_time,
                'end_time': end_time,
                'step': step,
                'timestamp': datetime.now().isoformat()
            }
        }
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error processing request for metric {metric_name}: {str(e)}")
        return jsonify({
            'error': f'Internal server error: {str(e)}',
            'data': []
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint
    """
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/', methods=['GET'])
def root():
    """
    Root endpoint with basic information
    """
    return jsonify({
        'service': 'Intent Report Query Proxy',
        'version': '1.0.0',
        'endpoints': {
            'get_metric_reports': '/api/get-metric-reports/<metric_name>',
            'health': '/health'
        }
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=3010) 