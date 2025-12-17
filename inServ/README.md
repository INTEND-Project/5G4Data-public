# inServ - Intent Management Service

inServ is a microservice that provides an Intent Management API router for the INTEND 5G4DATA use case. It implements the TM Forum Intent Management API (TMF921) specification and routes intents to appropriate inOrch (inOrch-TMF-Proxy) instances based on DataCenter information extracted from intent expressions. Routing of network intents to inNet will be added later.

## Overview

inServ acts as a central routing service that:
- Receives intent creation requests conforming to the TMF921 specification
- Extracts DataCenter information from Turtle expressions in intents
- Queries inGraph (GraphDB) to determine the appropriate inOrch instance for routing
- Forwards intents to the correct proxy instance
- Provides health check endpoints for monitoring

## Features

- **TMF921 API Implementation**: Full support for TM Forum Intent Management API v5.0
- **Intent Routing**: Automatic routing of intents to appropriate DataCenter proxies
- **GraphDB Integration**: Queries infrastructure data from GraphDB to determine routing targets
- **Turtle Expression Parsing**: Extracts DataCenter identifiers from Turtle expressions
- **OpenAPI/Swagger UI**: Interactive API documentation available at runtime
- **Health Checks**: Built-in health monitoring endpoints
- **Docker Support**: Containerized deployment with Gunicorn

## Architecture

```
Client Request
    ↓
inServ (Intent Router)
    ↓
Extract DataCenter from Turtle Expression
    ↓
Query GraphDB for DataCenter URL
    ↓
Route Intent to inOrch
    ↓
Return Response
```

## Prerequisites

- Python 3.11+ (for local development)
- Docker (for containerized deployment)
- GraphDB instance with infrastructure data
- Access to inOrch-TMF-Proxy instances

## Installation

### Docker Deployment

1. Build the Docker image (from the parent directory):
```bash
cd /path/to/5G4Data-public
./inServ/build.sh
```

Or manually:
```bash
docker build --no-cache -f inServ/Dockerfile -t inserv .
```

2. Run the container:
```bash
docker run --network host \
  -e GRAPHDB_BASE_URL=http://start5g-1.cs.uit.no:7200 \
  -e GRAPHDB_REPOSITORY=intents_and_intent_reports \
  inserv
```

To run the container in **test mode** with a fixed name and the `/logs` endpoint enabled:

```bash
docker run -d --network host \
  --name inserv \
  -e GRAPHDB_BASE_URL=http://start5g-1.cs.uit.no:7200 \
  -e GRAPHDB_REPOSITORY=intents_and_intent_reports \
  -e INSERV_TEST_MODE=true \
  -e ENABLE_LOG_ENDPOINT=true \
  -e INSERV_LOG_FILE=/app/logs/inserv.log \
  inserv
```

### Local Development

1. Clone the repository:
```bash
cd /path/to/5G4Data-public
```

2. Install dependencies:
```bash
cd inServ/src
pip install -r requirements.txt
pip install -e ../intent-report-client  # Install intent-report-client package
```

3. Set environment variables (see Configuration section)

4. Run the application:
```bash
python -m inserv
```

## Configuration

inServ can be configured using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `INSERV_HOST` | `0.0.0.0` | Host address to bind to |
| `INSERV_PORT` | `3021` | Port to listen on |
| `LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `GRAPHDB_BASE_URL` | `http://start5g-1.cs.uit.no:7200` | GraphDB server base URL |
| `GRAPHDB_REPOSITORY` | `intents_and_intent_reports` | GraphDB repository name |
| `ENABLE_GRAPHDB` | `true` | Enable/disable GraphDB integration |
| `INFRASTRUCTURE_GRAPH` | `http://intendproject.eu/telenor/infra` | Infrastructure graph URI in GraphDB |
| `DATACENTER_BASE_URL` | `http://start5g-1.cs.uit.no` | Base URL for DataCenter proxies |
| `DATACENTER_PORT_BASE` | `4000` | Base port number for DataCenter proxies |
| `API_PATH` | `/tmf-api/intentManagement/v5/` | API base path |

## API Endpoints

### Intent Management

- `POST /tmf-api/intentManagement/v5/intent` - Create a new intent (routed to appropriate proxy)
- `GET /tmf-api/intentManagement/v5/intent/{id}` - Retrieve intent (not implemented in inServ)
- `PATCH /tmf-api/intentManagement/v5/intent/{id}` - Update intent (not implemented in inServ)
- `DELETE /tmf-api/intentManagement/v5/intent/{id}` - Delete intent (not implemented in inServ)
- `GET /tmf-api/intentManagement/v5/intent` - List intents (not implemented in inServ)

### Health Check

- `GET /health` - Health check endpoint

### API Documentation

- Swagger UI available at: `http://localhost:3021/ui/`

## Usage Example

### Creating an Intent

See the client program in ../Lifecycle-Management/src/CreateIntent/

inServ will:
1. Extract the DataCenter identifier (e.g., "EC21") from the Turtle expression
2. Query GraphDB to find the URL for the inOrch-TMF-Proxy handling EC21
3. Forward the intent to that proxy
4. Return the response from the proxy

## Project Structure

```
inServ/
├── src/
│   └── inserv/
│       ├── __init__.py              # Application factory
│       ├── __main__.py               # Entry point
│       ├── config.py                 # Configuration management
│       ├── logging_config.py         # Logging setup
│       ├── wsgi.py                   # WSGI application
│       ├── health.py                 # Health check endpoints
│       ├── controllers/              # API controllers
│       │   ├── intent_controller.py
│       │   ├── intent_report_controller.py
│       │   ├── intent_specification_controller.py
│       │   ├── hub_controller.py
│       │   └── notification_listener_controller.py
│       ├── services/                 # Business logic services
│       │   ├── intent_router.py      # Intent routing logic
│       │   ├── infrastructure_service.py  # GraphDB queries
│       │   └── turtle_parser.py     # Turtle expression parsing
│       └── openapi/
│           └── openapi.yaml          # OpenAPI specification
├── Dockerfile                        # Docker image definition
├── build.sh                          # Build script
└── README.md                         # This file
```

## Dependencies

- **connexion**: OpenAPI framework for Flask
- **Flask**: Web framework
- **gunicorn**: WSGI HTTP server
- **requests**: HTTP library for routing requests
- **rdflib**: RDF/Turtle parsing
- **intent-report-client**: GraphDB client (installed separately)

