from flask import Flask, jsonify, request
import requests
import json
import os
import re
import base64
from datetime import datetime
from urllib.parse import parse_qs, quote, urlparse
import logging

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# GraphDB configuration
GRAPHDB_URL = os.environ.get('GRAPHDB_URL', "https://start5g-1.cs.uit.no/graphdb").rstrip('/')
GRAPHDB_USERNAME = os.environ.get('GRAPHDB_USERNAME', '').strip()
GRAPHDB_PASSWORD = os.environ.get('GRAPHDB_PASSWORD', '')
REPOSITORY = os.environ.get('GRAPHDB_REPOSITORY', "intents_and_intent_reports")
PROMETHEUS_EXECUTOR_URL = os.environ.get(
    'PROMETHEUS_EXECUTOR_URL', 'http://127.0.0.1:9090'
).rstrip('/')
REPOSITORY_ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]*$')
INTENT_ID_PATTERN = re.compile(r'^I[a-f0-9]{32}$', re.IGNORECASE)
COMPOUND_METRIC_PATTERN = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]*_CO[a-f0-9]{32}$', re.IGNORECASE)
GRAPH_IRI_PATTERN = re.compile(r'^urn:intend:kg:[a-zA-Z0-9][a-zA-Z0-9._:-]*$')

BOUNDS_SPARQL_TEMPLATE = """
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
PREFIX set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/>
PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
PREFIX data5g: <http://5g4data.eu/5g4data#>

SELECT ?value1 ?value2
WHERE {
  GRAPH <%s> {
    BIND(IRI(CONCAT("http://5g4data.eu/5g4data#", "%s")) AS ?intent)
    BIND(IRI(CONCAT("http://5g4data.eu/5g4data#", "%s")) AS ?metric)

    ?intent (log:allOf)+ ?condition .
    ?condition a icm:Condition .
    ?condition set:forAll ?forallBlock .
    ?forallBlock icm:valuesOfTargetProperty ?metric .

    OPTIONAL {
      ?forallBlock quan:inRange ?list .
      ?list rdf:rest ?list1 .
      ?list1 rdf:first ?node2 .
      ?node2 rdf:value ?rangeLower .
      OPTIONAL {
        ?list1 rdf:rest ?list2 .
        ?list2 rdf:first ?node3 .
        ?node3 rdf:value ?rangeUpper .
      }
    }

    OPTIONAL {
      { ?forallBlock quan:larger ?boundNode . ?boundNode rdf:value ?largerValue . }
      UNION
      { ?forallBlock quan:atLeast ?boundNode . ?boundNode rdf:value ?largerValue . }
    }

    OPTIONAL {
      { ?forallBlock quan:smaller ?boundNode . ?boundNode rdf:value ?smallerValue . }
      UNION
      { ?forallBlock quan:atMost ?boundNode . ?boundNode rdf:value ?smallerValue . }
    }

    BIND(COALESCE(?rangeLower, ?largerValue, 1) AS ?value1)
    BIND(COALESCE(
      ?rangeUpper,
      IF(BOUND(?largerValue), IF(?largerValue * 1000 > 1000000, ?largerValue * 1000, 1000000), ?largerValue),
      ?smallerValue
    ) AS ?value2)

    FILTER(BOUND(?value1) && BOUND(?value2))
  }
}
LIMIT 1
""".strip()


def graphdb_auth_headers(extra=None):
    """HTTP Basic auth when GRAPHDB_USERNAME and GRAPHDB_PASSWORD are set."""
    headers = dict(extra or {})
    if GRAPHDB_USERNAME and GRAPHDB_PASSWORD:
        token = base64.b64encode(
            f"{GRAPHDB_USERNAME}:{GRAPHDB_PASSWORD}".encode('utf-8')
        ).decode('ascii')
        headers['Authorization'] = f'Basic {token}'
    return headers


def is_prometheus_query_url(query_url):
    """Detect Prometheus instant/range API URLs (including public HTTPS paths without :9090)."""
    if not query_url:
        return False
    lowered = query_url.lower()
    return (
        ':9090' in lowered
        or 'api/v1/query' in lowered
        or 'api/v1/query_range' in lowered
        or '/prometheus/' in lowered
    )


def choose_stored_prometheus_query_url(urls):
    """Prefer executor-local URLs when GraphDB has duplicate hasQuery triples."""
    if not urls:
        return None
    if len(urls) == 1:
        return urls[0]

    def score(url):
        value = 0
        if '127.0.0.1' in url or 'localhost' in url:
            value += 20
        if '/prometheus/' in url or url.rstrip('/').endswith('/prometheus'):
            value += 10
        if 'start5g-1' in url:
            value += 5
        if 'host.docker.internal' in url:
            value -= 10
        if url.rstrip('/').endswith(':9090') or url.rstrip('/').endswith(':9090/'):
            value -= 5
        return value

    return max(urls, key=score)


def rewrite_prometheus_query_url(stored_url):
    """
    Rewrite GraphDB hasQuery URLs to PROMETHEUS_EXECUTOR_URL so this proxy always
    queries Prometheus on the host, regardless of duplicate or public metadata URLs.
    """
    if not stored_url or not is_prometheus_query_url(stored_url):
        return stored_url

    parsed = urlparse(stored_url)
    params = parse_qs(parsed.query)
    promql_values = params.get('query')
    if not promql_values or not promql_values[0]:
        logger.warning(f"Prometheus metadata URL missing query= param: {stored_url}")
        return stored_url

    promql = promql_values[0]
    api_path = 'api/v1/query_range' if 'query_range' in parsed.path else 'api/v1/query'
    return f"{PROMETHEUS_EXECUTOR_URL}/{api_path}?query={quote(promql, safe='')}"


def resolve_repository_id(raw_repository_id):
    """Resolve GraphDB repository from query param or env fallback."""
    repository_id = (raw_repository_id or REPOSITORY or '').strip()
    if not repository_id:
        return None, 'repository_id is required (query param or GRAPHDB_REPOSITORY env)'
    if not REPOSITORY_ID_PATTERN.match(repository_id):
        return None, 'Invalid repository_id'
    return repository_id, None


def sparql_escape_literal(value):
    return value.replace('\\', '\\\\').replace('"', '\\"')


def validate_bounds_params(intent_id, condition_metric, graph_iri):
    intent_id = (intent_id or '').strip()
    condition_metric = (condition_metric or '').strip()
    graph_iri = (graph_iri or '').strip()
    if not INTENT_ID_PATTERN.match(intent_id):
        return None, 'Invalid intent_id'
    if not COMPOUND_METRIC_PATTERN.match(condition_metric):
        return None, 'Invalid condition_metrics'
    if not GRAPH_IRI_PATTERN.match(graph_iri):
        return None, 'Invalid graph_iri'
    return {
        'intent_id': intent_id,
        'condition_metric': condition_metric,
        'graph_iri': graph_iri,
    }, None


def build_bounds_sparql(intent_id, condition_metric, graph_iri):
    graph = sparql_escape_literal(graph_iri)
    intent = sparql_escape_literal(intent_id)
    metric = sparql_escape_literal(condition_metric)
    return BOUNDS_SPARQL_TEMPLATE % (graph, intent, metric)


def run_graphdb_select(repository_id, sparql_query):
    response = requests.post(
        f"{GRAPHDB_URL}/repositories/{repository_id}",
        headers=graphdb_auth_headers({
            'Content-Type': 'application/sparql-query',
            'Accept': 'application/sparql-results+json',
        }),
        data=sparql_query,
        timeout=30,
    )
    if response.status_code != 200:
        logger.error('GraphDB bounds query failed: %s %s', response.status_code, response.text)
        return None
    return response.json()


def parse_bounds_bindings(result):
    bindings = result.get('results', {}).get('bindings', [])
    if not bindings:
        return None
    row = bindings[0]

    def numeric(binding_key):
        binding = row.get(binding_key)
        if not binding:
            return None
        raw = binding.get('value')
        if raw is None:
            return None
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None

    value1 = numeric('value1')
    value2 = numeric('value2')
    if value1 is None or value2 is None:
        return None
    return {'value1': value1, 'value2': value2}


PROMETHEUS_STEP_PATTERN = re.compile(
    r'^(?P<value>\d+(?:\.\d+)?)(?P<unit>ms|s|m|h|d|w|y)$',
    re.IGNORECASE,
)
PROMETHEUS_MAX_RANGE_POINTS = 10_000
PROMETHEUS_UNIT_SECONDS = {
    'ms': 0.001,
    's': 1,
    'm': 60,
    'h': 3600,
    'd': 86400,
    'w': 604800,
    'y': 31_557_600,
}


def parse_prometheus_step_to_seconds(step):
    """Parse Prometheus duration steps (e.g. 60s, 6h) to seconds."""
    if step is None:
        return None
    normalized = str(step).strip().lower()
    if not normalized:
        return None
    match = PROMETHEUS_STEP_PATTERN.match(normalized)
    if match:
        value = float(match.group('value'))
        unit = match.group('unit').lower()
        return int(value * PROMETHEUS_UNIT_SECONDS[unit])
    if normalized.isdigit():
        return int(normalized)
    return None


def format_prometheus_step(seconds):
    """Format seconds as a Prometheus step string."""
    seconds = max(1, int(seconds))
    for unit, multiplier in (
        ('w', 604_800),
        ('d', 86_400),
        ('h', 3600),
        ('m', 60),
        ('s', 1),
    ):
        if seconds >= multiplier and seconds % multiplier == 0:
            return f'{seconds // multiplier}{unit}'
    return f'{seconds}s'


def resolve_prometheus_step(step, time_range_seconds):
    """Choose a Prometheus step that honors Grafana input and stays under point limits."""
    step_seconds = parse_prometheus_step_to_seconds(step)
    if step_seconds is None or step_seconds <= 0:
        if time_range_seconds <= 3600:
            step_seconds = 30
        elif time_range_seconds <= 86_400:
            step_seconds = 60
        elif time_range_seconds <= 604_800:
            step_seconds = 300
        else:
            step_seconds = 3600

    estimated_points = time_range_seconds / step_seconds
    if estimated_points > PROMETHEUS_MAX_RANGE_POINTS:
        adjusted = max(60, int(time_range_seconds / PROMETHEUS_MAX_RANGE_POINTS) + 1)
        logger.info(
            'Step adjusted from %ss to %ss for Prometheus limit (range=%ss, estimated=%.0f points)',
            step_seconds,
            adjusted,
            time_range_seconds,
            estimated_points,
        )
        step_seconds = adjusted

    return format_prometheus_step(step_seconds)


def query_intent_metric_bounds(intent_id, condition_metric, graph_iri, repository_id):
    params, error = validate_bounds_params(intent_id, condition_metric, graph_iri)
    if error:
        return None, error
    sparql_query = build_bounds_sparql(
        params['intent_id'],
        params['condition_metric'],
        params['graph_iri'],
    )
    result = run_graphdb_select(repository_id, sparql_query)
    if result is None:
        return None, 'GraphDB bounds query failed'
    bounds = parse_bounds_bindings(result)
    if bounds is None:
        return None, 'No intent bounds found for metric'
    return bounds, None


def get_metric_query(metric_name, repository_id):
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
    
    logger.info(f"Getting metric query for: {metric_name}")
    logger.info(f"GraphDB URL: {GRAPHDB_URL}/repositories/{repository_id}")
    
    try:
        # Make request to GraphDB
        response = requests.post(
            f"{GRAPHDB_URL}/repositories/{repository_id}",
            headers=graphdb_auth_headers({
                "Content-Type": "application/sparql-query",
                "Accept": "application/sparql-results+json"
            }),
            data=sparql_query
        )
        
        logger.info(f"GraphDB response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            logger.info(f"GraphDB response: {result}")
            bindings = result.get('results', {}).get('bindings') or []
            if bindings:
                urls = [
                    row['object']['value']
                    for row in bindings
                    if row.get('object', {}).get('value')
                ]
                if len(urls) > 1:
                    logger.warning(
                        f"Metric {metric_name} has {len(urls)} hasQuery URLs in metadata; "
                        "using best match and rewriting for executor"
                    )
                stored = choose_stored_prometheus_query_url(urls)
                query_value = rewrite_prometheus_query_url(stored)
                logger.info(f"Retrieved query value (executor): {query_value}")
                return query_value
            else:
                logger.warning(f"No query found for metric: {metric_name}")
                logger.warning(f"GraphDB response bindings: {bindings}")
                return None
        else:
            logger.error(f"GraphDB request failed with status {response.status_code}")
            logger.error(f"GraphDB response text: {response.text}")
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
        logger.info(f"execute_observation_query called with query: {query}")
        logger.info(f"execute_observation_query called with step: {step}")
        # Modify query URL to include time range parameters if provided
        modified_query = query
        if start_time and end_time:
            # Handle different query types
            is_prometheus_query = is_prometheus_query_url(query)
            logger.info(f"Query detection debug - query: {query}")
            logger.info(f"Query detection debug - contains :9090: {':9090' in query}")
            logger.info(f"Query detection debug - contains api/v1/query: {'api/v1/query' in query}")
            logger.info(f"Query detection debug - contains api/v1/query_range: {'api/v1/query_range' in query}")
            logger.info(f"Query detection debug - is_prometheus_query: {is_prometheus_query}")
            
            if is_prometheus_query:
                # For Prometheus range queries, use query_range endpoint
                if 'api/v1/query' in query and 'api/v1/query_range' not in query:
                    # Convert instant query to range query
                    modified_query = query.replace('api/v1/query', 'api/v1/query_range')
                
                # Add time range parameters to the URL
                separator = '&' if '?' in modified_query else '?'
                time_range = None
                try:
                    start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    end_dt = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                    time_range = int((end_dt - start_dt).total_seconds())
                    logger.info(f"Calculated time range: {time_range} seconds")
                except Exception as e:
                    logger.warning(f"Could not calculate time range from ISO timestamps: {e}")

                if time_range is None or time_range <= 0:
                    step_param = step.strip() if step and step.strip() else '60s'
                else:
                    step_param = resolve_prometheus_step(step, time_range)

                logger.info(f"Step parameter debug - provided: '{step}', resolved: '{step_param}'")
                
                # Always add step parameter for Prometheus range queries
                modified_query = f"{modified_query}{separator}start={start_time}&end={end_time}&step={step_param}"
                logger.info(f"Step parameter debug - final step: {step_param}")
                
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
                    logger.info(f"Full Prometheus response: {rest_data}")
                    if 'data' in rest_data and 'result' in rest_data['data']:
                        logger.info(f"Prometheus data result count: {len(rest_data['data']['result'])}")
                        if rest_data['data']['result']:
                            first_result = rest_data['data']['result'][0]
                            logger.info(f"First result keys: {list(first_result.keys())}")
                            if 'values' in first_result:
                                logger.info(f"Values count: {len(first_result['values'])}")
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
                logger.info(f"Parsing Prometheus response with {len(results)} results")
                for i, result in enumerate(results):
                    logger.info(f"Processing result {i+1}: {list(result.keys())}")
                    if 'values' in result:
                        # Matrix format
                        logger.info(f"Processing matrix format with {len(result['values'])} values")
                        for value_pair in result['values']:
                            timestamp, value = value_pair
                            binding = {
                                'timestamp': {'value': str(timestamp)},
                                'value': {'value': str(value)},
                                'metric': {'value': result.get('metric', {}).get('__name__', 'unknown')}
                            }
                            sparql_format['results']['bindings'].append(binding)
                        logger.info(f"Added {len(result['values'])} bindings from matrix")
                    elif 'value' in result:
                        # Vector format
                        logger.info("Processing vector format")
                        timestamp, value = result['value']
                        binding = {
                            'timestamp': {'value': str(timestamp)},
                            'value': {'value': str(value)},
                            'metric': {'value': result.get('metric', {}).get('__name__', 'unknown')}
                        }
                        sparql_format['results']['bindings'].append(binding)
                logger.info(f"Total bindings created: {len(sparql_format['results']['bindings'])}")
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

def is_legacy_api_request(repository_arg):
    """Legacy callers omit repository_id and use env-default repo + ISO timestamps."""
    return repository_arg is None or not str(repository_arg).strip()


def format_timestamp_value(value, legacy_api=False):
    if not value.isdigit() or len(value) < 10:
        timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if legacy_api:
            return timestamp.isoformat()
        return int(timestamp.timestamp() * 1000)

    if legacy_api:
        return datetime.fromtimestamp(float(value)).isoformat()
    return int(float(value)) * 1000


def format_for_grafana_infinity(sparql_results, legacy_api=False):
    """
    Format SPARQL results for Grafana Infinity data source.
    legacy_api=True keeps the original ISO timestamp strings and meta shape.
    """
    logger.info(f"Formatting for Grafana Infinity - input: {sparql_results is not None}")
    if not sparql_results or 'results' not in sparql_results:
        logger.warning("No sparql_results or missing 'results' key")
        return []
    
    # Extract column names from the SPARQL results
    columns = []
    if sparql_results['results']['bindings']:
        columns = list(sparql_results['results']['bindings'][0].keys())
        logger.info(f"Found columns: {columns}")
    
    logger.info(f"Processing {len(sparql_results['results']['bindings'])} bindings")
    
    # Format data for Infinity
    formatted_data = []
    
    for i, binding in enumerate(sparql_results['results']['bindings']):
        row = {}
        for column in columns:
            if column in binding:
                value = binding[column]['value']
                # Try to parse as timestamp if it looks like one
                if 'time' in column.lower() or 'date' in column.lower():
                    try:
                        row[column] = format_timestamp_value(value, legacy_api=legacy_api)
                    except:
                        row[column] = value
                elif column == 'value':
                    try:
                        row[column] = float(value)
                    except (TypeError, ValueError):
                        row[column] = value
                else:
                    row[column] = value
        if not legacy_api:
            row.setdefault('unit', '')
        formatted_data.append(row)
    
    logger.info(f"Formatted {len(formatted_data)} data points for Grafana")
    return formatted_data

def parse_epoch_timestamp(value):
    """Parse Grafana __from/__to values sent as epoch seconds or milliseconds."""
    if not value or not str(value).isdigit():
        return None
    numeric = int(value)
    if numeric > 1_000_000_000_000:
        return datetime.utcfromtimestamp(numeric / 1000)
    return datetime.utcfromtimestamp(numeric)


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
        
        repository_arg = request.args.get('repository_id') or request.args.get('repository')
        legacy_api = is_legacy_api_request(repository_arg)
        repository_id, repo_error = resolve_repository_id(repository_arg)
        if repo_error:
            return jsonify({'error': repo_error, 'data': []}), 400

        logger.info(
            f"Requesting metric reports for: {metric_name} "
            f"(repository: {repository_id}, legacy_api: {legacy_api})"
        )
        if start_time and end_time:
            logger.info(f"Time range: {start_time} to {end_time}")
            logger.info(f"Step parameter: {step}")
            # Convert timestamps to ISO format for Prometheus queries
            try:
                # Check if timestamps are in Unix format (numeric) or ISO format
                if start_time and start_time.isdigit():
                    start_dt = parse_epoch_timestamp(start_time)
                    if start_dt:
                        start_time = start_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
                elif start_time and 'T' in start_time:
                    # Already in ISO format, ensure Z format
                    start_time = start_time.replace('Z', 'Z')
                
                if end_time and end_time.isdigit():
                    end_dt = parse_epoch_timestamp(end_time)
                    if end_dt:
                        end_time = end_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
                elif end_time and 'T' in end_time:
                    # Already in ISO format, ensure Z format
                    end_time = end_time.replace('Z', 'Z')
                
                logger.info(f"Timestamps for Prometheus - start: {start_time}, end: {end_time}")
            except Exception as e:
                logger.warning(f"Could not process timestamps: {e}")
        
        # Get the metric query from GraphDB
        metric_query = get_metric_query(metric_name, repository_id)
        
        if not metric_query:
            logger.error(
                f"No query found for metric: {metric_name}"
                + (f" in repository: {repository_id}" if not legacy_api else "")
            )
            error_message = (
                f'No query found for metric: {metric_name}'
                if legacy_api
                else f'No query found for metric: {metric_name} in repository: {repository_id}'
            )
            return jsonify({
                'error': error_message,
                'data': []
            }), 404
        
        logger.info(f"Retrieved query for metric {metric_name}: {metric_query}")
        logger.info(f"Query type check - contains :9090: {':9090' in metric_query}")
        logger.info(f"Query type check - contains :7200: {':7200' in metric_query}")
        logger.info(f"Query type check - contains api/v1/query: {'api/v1/query' in metric_query}")
        logger.info(f"Query type check - contains repositories: {'repositories' in metric_query}")
        
        # Execute the observation query with time range and step if provided
        logger.info(f"About to execute query: {metric_query}")
        observation_results = execute_observation_query(metric_query, start_time, end_time, step)
        
        if not observation_results:
            return jsonify({
                'error': 'Failed to execute REST query. Check the application logs for details.',
                'data': []
            }), 500
        
        # Format results for Grafana Infinity
        formatted_data = format_for_grafana_infinity(observation_results, legacy_api=legacy_api)
        
        # Return data in format suitable for Grafana Infinity
        meta = {
            'metric_name': metric_name,
            'query': metric_query,
            'start_time': start_time,
            'end_time': end_time,
            'step': step,
            'timestamp': datetime.now().isoformat()
        }
        if not legacy_api:
            meta['repository_id'] = repository_id

        response_data = {
            'data': formatted_data,
            'meta': meta,
        }
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error processing request for metric {metric_name}: {str(e)}")
        return jsonify({
            'error': f'Internal server error: {str(e)}',
            'data': []
        }), 500

@app.route('/api/get-metric-bounds', methods=['GET'])
def get_metric_bounds():
    """Intent SLO bounds for Grafana threshold bands (Infinity datasource)."""
    try:
        repository_arg = request.args.get('repository_id') or request.args.get('repository')
        repository_id, repo_error = resolve_repository_id(repository_arg)
        if repo_error:
            return jsonify({'error': repo_error, 'data': []}), 400

        intent_id = request.args.get('intent_id')
        condition_metric = request.args.get('condition_metrics') or request.args.get('metric_name')
        graph_iri = request.args.get('graph_iri')

        bounds, bounds_error = query_intent_metric_bounds(
            intent_id,
            condition_metric,
            graph_iri,
            repository_id,
        )
        if bounds_error:
            status = 404 if 'No intent bounds' in bounds_error else 400
            return jsonify({'error': bounds_error, 'data': []}), status

        return jsonify({
            'data': [bounds],
            'meta': {
                'repository_id': repository_id,
                'intent_id': intent_id,
                'condition_metrics': condition_metric,
                'graph_iri': graph_iri,
                'timestamp': datetime.now().isoformat(),
            },
        })
    except Exception as exc:
        logger.error('Error fetching metric bounds: %s', exc)
        return jsonify({'error': f'Internal server error: {exc}', 'data': []}), 500


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
            'get_metric_reports_legacy': '/api/get-metric-reports/<metric_name>?start=&end=&step= (no repository_id)',
            'get_metric_bounds': '/api/get-metric-bounds?repository_id=&graph_iri=&intent_id=&condition_metrics=',
            'health': '/health'
        }
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=3010) 