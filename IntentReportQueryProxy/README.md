# Intent Report Query Proxy

A Flask application that functions as a query proxy for intent report observations. The application retrieves metric queries from GraphDB and executes them to provide formatted data for Grafana Infinity data source.

## Features

- **GET Route**: `/api/get-metric-reports/<metric_name>` - Retrieves metric reports for a specific metric
- **GraphDB Integration**: Queries GraphDB to retrieve SPARQL queries for metrics
- **Grafana Infinity Support**: Formats data for use with Grafana Infinity data source
- **Health Check**: `/health` endpoint for monitoring
- **Error Handling**: Comprehensive error handling and logging

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Configuration

The application is configured to connect to GraphDB at `http://start5g-1.cs.uit.no:7200`. You may need to adjust the following in `app.py`:

- `GRAPHDB_URL`: The URL of your GraphDB instance
- `REPOSITORY`: The name of your GraphDB repository (default: "intent-reports")

## Usage

### Starting the Application

```bash
python app.py
```

The application will start on `http://localhost:3010`

### API Endpoints

#### Get Metric Reports
```
GET /api/get-metric-reports/<metric_name>?start=<start_time>&end=<end_time>
```

**Parameters:**
- `start` (optional): Start time in Unix timestamp or ISO format
- `end` (optional): End time in Unix timestamp or ISO format

**Example:**
```bash
# Without time range
curl http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1

# With time range
curl "http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start=1640995200&end=1641081600"
```

**Response Format:**
```json
{
  "data": [
    {
      "timestamp": "2023-01-01T12:00:00",
      "value": 100.5,
      "unit": "Mbps"
    }
  ],
  "meta": {
    "metric_name": "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1",
    "query": "SELECT ?timestamp ?value WHERE {...}",
    "timestamp": "2023-01-01T12:00:00"
  }
}
```

#### Health Check
```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2023-01-01T12:00:00"
}
```

#### Root Endpoint
```
GET /
```

**Response:**
```json
{
  "service": "Intent Report Query Proxy",
  "version": "1.0.0",
  "endpoints": {
    "get_metric_reports": "/api/get-metric-reports/<metric_name>",
    "health": "/health"
  }
}
```

## Grafana Infinity Integration

The application formats data specifically for Grafana Infinity data source. To use this with Grafana:

1. Install the Infinity data source plugin in Grafana
2. Configure a new data source pointing to this Flask application
3. Use the `/api/get-metric-reports/<metric_name>` endpoint as your data source URL
4. Configure the panel to parse the JSON response

### Example Grafana Configuration

**Data Source URL:**
```
http://localhost:3010/api/get-metric-reports/your_metric_name?start=${__from:date:iso}&end=${__to:date:iso}
```

**Parser:**
- Type: JSON
- Root: `data`

**Time Series Configuration:**
- Time Field: `timestamp`
- Value Field: `value`

**Grafana Variables:**
- `${__from:date:iso}`: Start time in ISO format
- `${__to:date:iso}`: End time in ISO format

## Error Handling

The application includes comprehensive error handling:

- **404**: When no query is found for the specified metric
- **500**: When GraphDB queries fail or internal errors occur
- **Logging**: All operations are logged for debugging

## Development

### Running in Development Mode

```bash
python app.py
```

The application runs with debug mode enabled by default.

### Production Deployment

For production deployment, consider using a WSGI server like Gunicorn:

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

## Architecture

1. **Request Processing**: The application receives requests for specific metrics
2. **Query Retrieval**: It queries GraphDB to get the REST URL for the metric
3. **Data Execution**: Executes the retrieved REST URL to get observation data
4. **Formatting**: Formats the results for Grafana Infinity compatibility
5. **Response**: Returns formatted JSON data

## Dependencies

- **Flask**: Web framework
- **requests**: HTTP client for GraphDB communication
- **Werkzeug**: WSGI utilities

## License

This project is part of the INTEND-Project/5G4Data-public initiative. 