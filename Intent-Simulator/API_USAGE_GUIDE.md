# Intent Simulator API Usage Guide

This guide explains how to use Python scripts to generate intents with the Intent Simulator API.

## Prerequisites

1. **Start the Intent Simulator server**:
   ```bash
   cd /path/to/Intent-Simulator
   export PYTHONPATH=$PYTHONPATH:.
   flask run --port 5000
   ```

2. **Install required Python packages**:
   ```bash
   pip install requests
   ```

## API Endpoints

### 1. Generate Intent
**POST** `/api/generate-intent`

Generate and store one or more intents in GraphDB.

**Request Body:**
```json
{
    "intent_type": "network|workload|combined",
    "parameters": {
        // Intent-specific parameters (see below)
    },
    "count": 1,
    "interval": 0.0
}
```

**Response:**
```json
{
    "message": "Intent generated and stored successfully: <intent_id>",
    "intent_ids": ["<intent_id>"]
}
```

### 2. Get Intent
**GET** `/api/get-intent/<intent_id>`

Retrieve a specific intent by its ID.

**Response:**
```json
{
    "intent_id": "<intent_id>",
    "data": "<turtle_format_intent_data>"
}
```

### 3. Query Intents
**GET** `/api/query-intents`

Get all stored intents with their metadata.

**Response:**
```json
{
    "intents": [
        {
            "id": "<intent_id>",
            "type": "Network|Workload|Combined"
        }
    ]
}
```

### 4. Delete Intent
**DELETE** `/api/delete-intent/<intent_id>`

Delete a specific intent and its associated file.

### 5. Delete All Intents
**POST** `/api/delete-all-intents`

Delete all intents from GraphDB and the intents directory.

## Intent Types and Parameters

### Network Intent (`intent_type: "network"`)

Creates network slice configuration intents with QoS guarantees.

**Parameters:**
- `description` (string): Description of the intent
- `latency` (number): Latency requirement in milliseconds
- `latency_operator` (string): Operator for latency ("smaller", "larger", "atLeast", "atMost", "greater", "inRange", "mean", "median")
- `latency_end` (number): End value for "inRange" operator
- `bandwidth` (number): Bandwidth requirement in mbit/s
- `bandwidth_operator` (string): Operator for bandwidth
- `bandwidth_end` (number): End value for "inRange" operator
- `location` (string): Geographical location (e.g., "Oslo, Norway")
- `customer` (string): Customer identifier
- `handler` (string): Intent handler
- `owner` (string): Intent owner

**Example:**
```python
network_params = {
    "description": "High-performance network slice for gaming",
    "latency": 10,
    "latency_operator": "smaller",
    "bandwidth": 1000,
    "bandwidth_operator": "larger",
    "location": "Oslo, Norway",
    "customer": "+47 12345678"
}
```

### Workload Intent (`intent_type: "workload"`)

Creates workload deployment intents for cloud-native applications.

**Parameters:**
- `description` (string): Description of the intent
- `compute_latency` (number): Compute latency requirement in milliseconds
- `compute_latency_operator` (string): Operator for compute latency
- `compute_latency_end` (number): End value for "inRange" operator
- `datacenter` (string): Target datacenter (e.g., "EC1", "EC2")
- `application` (string): Application name
- `descriptor` (string): Deployment descriptor URL
- `handler` (string): Intent handler
- `owner` (string): Intent owner

**Example:**
```python
workload_params = {
    "description": "Deploy AR retail application to edge datacenter",
    "compute_latency": 5,
    "compute_latency_operator": "smaller",
    "datacenter": "EC2",
    "application": "ar-retail-v2",
    "descriptor": "http://intend.eu/5G4DataWorkloadCatalogue/ar-retail-deployment.yaml"
}
```

### Combined Intent (`intent_type: "combined"`)

Creates intents that combine both network and workload requirements.

**Parameters:**
All parameters from both network and workload intents.

**Example:**
```python
combined_params = {
    "description": "Combined network and workload deployment for IoT sensors",
    "latency": 15,
    "latency_operator": "smaller",
    "bandwidth": 500,
    "bandwidth_operator": "larger",
    "compute_latency": 8,
    "compute_latency_operator": "smaller",
    "location": "Bergen, Norway",
    "customer": "+47 87654321",
    "datacenter": "EC3",
    "application": "iot-sensor-manager"
}
```

## Usage Examples

### Basic Usage
```python
import requests

# Generate a single network intent
data = {
    "intent_type": "network",
    "parameters": {
        "description": "High-speed network slice",
        "latency": 5,
        "bandwidth": 1000,
        "location": "Oslo, Norway"
    }
}

response = requests.post("http://localhost:5000/api/generate-intent", json=data)
result = response.json()
print(f"Generated intent: {result['intent_ids'][0]}")
```

### Batch Generation
```python
# Generate multiple intents with interval
data = {
    "intent_type": "network",
    "parameters": {
        "description": "Batch network slice generation",
        "latency": 20,
        "bandwidth": 300
    },
    "count": 5,
    "interval": 2.0  # 2 seconds between each intent
}

response = requests.post("http://localhost:5000/api/generate-intent", json=data)
result = response.json()
print(f"Generated {len(result['intent_ids'])} intents")
```

### Using the Client Class
```python
from example_api_client import IntentSimulatorClient

client = IntentSimulatorClient("http://localhost:5000")

# Generate intent
result = client.generate_intent("network", network_params)
intent_id = result['intent_ids'][0]

# Retrieve intent
intent_data = client.get_intent(intent_id)

# Query all intents
all_intents = client.query_intents()
```

## Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Bad Request (invalid parameters)
- `404`: Not Found (intent doesn't exist)
- `500`: Internal Server Error

Always handle exceptions when making API calls:

```python
try:
    response = requests.post(API_URL, json=data)
    response.raise_for_status()
    result = response.json()
    print("Success:", result)
except requests.exceptions.RequestException as e:
    print(f"API Error: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")
```

## Advanced Features

### Location-based Polygon Generation
When you provide a `location` parameter, the system uses OpenAI's GPT-4o-mini to generate appropriate geographical polygons. Make sure to set the `OPENAI_API_KEY` environment variable.

### Intent Storage
All generated intents are:
1. Stored in GraphDB for querying and management
2. Saved as `.ttl` files in the `intents/` directory
3. Assigned unique IDs for tracking and retrieval

### SPARQL Queries
You can query the stored intents using SPARQL through the GraphDB interface or by using the `/api/query-intents` endpoint.

## Running the Examples

1. **Start the Intent Simulator server**:
   ```bash
   flask run --port 5000
   ```

2. **Run the simple example**:
   ```bash
   python simple_api_example.py
   ```

3. **Run the comprehensive example**:
   ```bash
   python example_api_client.py
   ```

## Troubleshooting

- **Connection refused**: Make sure the Intent Simulator server is running on the correct port
- **Invalid parameters**: Check that all required parameters are provided and have correct types
- **GraphDB errors**: Ensure GraphDB is running and accessible at the configured URL
- **OpenAI errors**: Verify that `OPENAI_API_KEY` is set correctly for location-based polygon generation
