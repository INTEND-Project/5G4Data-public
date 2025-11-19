# Intent Report Client

A Python package for interacting with GraphDB and Prometheus for intent reports in the 5G4Data project.

## Installation

### Install from local directory (editable mode)

```bash
pip install -e /path/to/intent-report-client
```

Or from within the repository:

```bash
cd /path/to/5G4Data-public/intent-report-client
pip install -e .
```

### Install as regular package

```bash
cd /path/to/5G4Data-public/intent-report-client
pip install .
```

## Usage

### IntentReportClient

The `IntentReportClient` class provides methods for interacting with GraphDB to store and retrieve intent reports.

```python
from intent_report_client import IntentReportClient

# Initialize the client
client = IntentReportClient(
    base_url="http://your-graphdb-server:7200",
    repository="intent-reports"
)

# Store an intent report
turtle_data = """
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix data5g: <http://5g4data.eu/5g4data#> .

icm:Report1 rdf:type icm:IntentReport ;
    icm:about data5g:I123 ;
    icm:reportNumber "1"^^xsd:integer .
"""

success = client.store_intent_report(turtle_data)

# Get an intent
intent_data = client.get_intent("123")

# Get all intents
intents = client.get_intents()

# Get the last report for an intent
last_report = client.get_last_intent_report("123")
```

### PrometheusClient

The `PrometheusClient` class provides methods for storing observations in Prometheus.

```python
from intent_report_client import PrometheusClient
from datetime import datetime

# Initialize the client
client = PrometheusClient(prometheus_url="http://your-prometheus-server:9090")

# Store an observation
success = client.store_observation(
    metric_name="network_latency",
    value=42.5,
    timestamp=datetime.now(),
    labels={"intent_id": "123", "slice_id": "slice1"}
)

# Get a metric value
value = client.get_metric_value("network_latency", labels={"intent_id": "123"})
```

## Environment Variables

The following environment variables can be used to configure the clients:

- `GRAPHDB_URL`: Default GraphDB server URL (default: `http://start5g-1.cs.uit.no:7200`)
- `GRAPHDB_REPOSITORY`: Default repository name (default: `intent-reports`)
- `PROMETHEUS_URL`: Default Prometheus server URL (default: `http://start5g-1.cs.uit.no:9090`)
- `PUSHGATEWAY_URL`: Prometheus Pushgateway URL (default: `http://start5g-1.cs.uit.no:9091`)

## Development

To contribute to this package:

1. Clone the repository
2. Install in editable mode: `pip install -e .`
3. Install development dependencies: `pip install -e ".[dev]"`

## License

MIT License

