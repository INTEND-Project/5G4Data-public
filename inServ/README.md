# inServ - Intent Management Service

inServ is a microservice that provides an Intent Management API router for the INTEND 5G4DATA use case. It implements the TM Forum Intent Management API (TMF921) specification and intelligently routes intents to appropriate handlers (inOrch-TMF-Proxy or inNet) based on the expectations contained in intent expressions. When an intent contains both NetworkExpectation and DeploymentExpectation, inServ automatically splits it into two separate intents and routes them to the appropriate handlers.

## Overview

inServ acts as a central routing service that:
- Receives intent creation requests conforming to the TMF921 specification
- Analyzes Turtle expressions to detect NetworkExpectation and DeploymentExpectation
- Routes intents based on their content:
  - **NetworkExpectation only** → routes to inNet
  - **DeploymentExpectation only** → routes to inOrch-TMF-Proxy (via GraphDB lookup)
  - **Both NE and DE** → splits the intent and routes to both handlers, returns bundle response
- Extracts DataCenter information from Turtle expressions for inOrch routing
- Queries inGraph (GraphDB) to determine the appropriate inOrch instance for deployment intents
- Provides health check endpoints for monitoring

## Features

- **TMF921 API Implementation**: Full support for TM Forum Intent Management API v5.0
- **Intelligent Intent Routing**: Automatic routing based on expectation types (NetworkExpectation, DeploymentExpectation)
- **Intent Splitting**: Automatically splits intents containing both NE and DE into separate intents
- **Dual Handler Support**: Routes to both inNet (network intents) and inOrch-TMF-Proxy (deployment intents)
- **GraphDB Integration**: Queries infrastructure data from GraphDB to determine inOrch routing targets
- **Turtle Expression Parsing**: Extracts expectations and DataCenter identifiers from Turtle expressions
- **Bundle Responses**: Returns bundled responses when intents are split across handlers
- **OpenAPI/Swagger UI**: Interactive API documentation available at runtime
- **Health Checks**: Built-in health monitoring endpoints
- **Docker Support**: Containerized deployment with Gunicorn

## Architecture

```
Client Request
    ↓
inServ (Intent Router)
    ↓
Parse Turtle Expression
    ↓
Detect Expectations (NE/DE/RE)
    ↓
    ├─→ Only NetworkExpectation → Route to inNet
    ├─→ Only DeploymentExpectation → Query GraphDB → Route to inOrch
    └─→ Both NE + DE → Split Intent
            ├─→ NE Intent → Route to inNet
            └─→ DE Intent → Query GraphDB → Route to inOrch
                    ↓
            Return Bundle Response
```

## Prerequisites

- Python 3.11+ (for local development)
- Docker (for containerized deployment)
- GraphDB instance with infrastructure data (for inOrch routing)
- Access to inOrch-TMF-Proxy instances (for deployment intents)
- Access to inNet service (for network intents)

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
# If -e INSERV_PORT=3021 is omittet, defaults to 3021
# If -e GRAPHDB_BASE_URL=7200 is omittet, defaults to 7200
docker run --network host \
  -e INSERV_PORT=3021 \ 
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
| `INNET_BASE_URL` | `http://intend.eu/inNet` | Base URL for inNet service |
| `API_PATH` | `/tmf-api/intentManagement/v5/` | API base path |
| `INSERV_TEST_MODE` | `false` | Enable test mode (logs intents without forwarding) |
| `ENABLE_LOG_ENDPOINT` | `false` | Enable `/logs` endpoint for browsing logs |

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

### Routing Behavior

inServ automatically determines the routing based on the expectations in the intent:

**NetworkExpectation only:**
1. Detects NetworkExpectation in Turtle expression
2. Routes intent to inNet at `{INNET_BASE_URL}/intent`
3. Returns response from inNet

**DeploymentExpectation only:**
1. Extracts DataCenter identifier (e.g., "EC21") from the Turtle expression
2. Queries GraphDB to find the URL for the inOrch-TMF-Proxy handling that DataCenter
3. Routes intent to that proxy
4. Returns response from inOrch

**Both NetworkExpectation and DeploymentExpectation:**
1. Detects both expectations in Turtle expression
2. Splits the intent into two parts:
   - NE intent: Contains NetworkExpectation + all RequirementExpectations
   - DE intent: Contains DeploymentExpectation + all RequirementExpectations
3. Routes NE intent to inNet
4. Routes DE intent to inOrch (via GraphDB lookup)
5. Returns a bundle response containing both responses with `isBundle: true`

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

