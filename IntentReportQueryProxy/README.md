# Intent Report Query Proxy

A Dockerized Flask application that functions as a query proxy for intent report observations. The application retrieves metric queries from GraphDB and executes them to provide formatted data for Grafana Infinity data source.

## Overview

The Intent Report Query Proxy acts as an intermediary between Grafana dashboards and GraphDB, enabling dynamic metric queries for intent-based network management. It:

1. **Retrieves metadata** from GraphDB to find the appropriate query for each metric
2. **Executes queries** against various data sources (GraphDB, Prometheus, etc.)
3. **Formats responses** for Grafana Infinity data source compatibility
4. **Supports time ranges** and step parameters for time-series visualization

## Architecture

```
Grafana Dashboard → Intent Report Query Proxy → GraphDB (metadata) → Data Sources
                                                      ↓
                                              Prometheus/GraphDB/etc.
```
Example Grafana dashboards can be found in ../IntentDashboard (e.g the Intent and Condition Metrics Timeseries Dashboard.json uses the proxy)

# Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Access to GraphDB instance at `http://start5g-1.cs.uit.no:7200`
- GraphDB repository: `intents_and_intent_reports`

### Build and Run

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd IntentReportQueryProxy
   ```

2. **Build and start the service**
   ```bash
   docker-compose up -d
   ```

3. **Verify the service is running**
   ```bash
   curl http://localhost:3010/health
   ```

The service will be available at `http://localhost:3010`

## API Endpoints

### Health Check
```
GET /health
```
Returns service status and timestamp.

### Get Metric Reports
```
GET /api/get-metric-reports/<metric_name>?start=<start_time>&end=<end_time>&step=<step>
```

**Parameters:**
- `metric_name`: The metric identifier (e.g., `computelatency_CO70ae24ceec1b473abab9cbffa94223a8`)
- `start` (optional): Start time in Unix timestamp or ISO format
- `end` (optional): End time in Unix timestamp or ISO format  
- `step` (optional): Step interval for time-series data (e.g., `15s`, `1m`, `1h`)

**Example:**
```bash
curl "http://localhost:3010/api/get-metric-reports/computelatency_CO70ae24ceec1b473abab9cbffa94223a8?start=1760693216851&end=1760704016851&step=20s"
```

**Response Format:**
```json
{
  "data": [
    {
      "timestamp": "2025-10-17T09:26:51+00:00",
      "value": "47.0",
      "unit": "ms"
    }
  ],
  "meta": {
    "metric_name": "computelatency_CO70ae24ceec1b473abab9cbffa94223a8",
    "query": "http://start5g-1.cs.uit.no:7200/repositories/...",
    "start_time": "2025-10-17T09:26:56Z",
    "end_time": "2025-10-17T12:26:56Z",
    "step": "20s",
    "timestamp": "2025-10-17T12:31:45.499644"
  }
}
```

## Docker Configuration

### Environment Variables

The application can be configured using environment variables:

- `GRAPHDB_URL`: GraphDB instance URL (default: `http://start5g-1.cs.uit.no:7200`)
- `GRAPHDB_REPOSITORY`: GraphDB repository name (default: `intents_and_intent_reports`)
- `FLASK_HOST`: Flask host binding (default: `0.0.0.0`)
- `FLASK_PORT`: Flask port (default: `3010`)

### Docker Compose

The `docker-compose.yml` file includes:
- Service definition with health checks
- Automatic restart policy
- Host network mode for external access
- Health check endpoint monitoring

### Custom Configuration

To use custom GraphDB settings:

```bash
# Create a .env file
echo "GRAPHDB_URL=http://your-graphdb:7200" > .env
echo "GRAPHDB_REPOSITORY=your-repository" >> .env

# Start with custom configuration
docker-compose up -d
```

## Development

### Rebuilding the Container

After code changes:

```bash
# Rebuild without cache
docker-compose build --no-cache

# Restart the service
docker-compose up -d
```

## Troubleshooting

### Common Issues

1. **404 "No query found for metric"**
   - Verify the metric exists in GraphDB metadata
   - Check GraphDB repository name configuration

2. **Connection refused to GraphDB**
   - Verify GraphDB URL and accessibility
   - Check network connectivity

3. **Empty data responses**
   - Verify time range parameters
   - Check if data exists for the specified time period

### Logs

View container logs:
```bash
docker-compose logs -f intent-report-proxy
```