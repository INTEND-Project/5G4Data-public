# Intent Report Simulator

A simulator for generating TM Forum formatted intents for the 5G4DATA use case. This tool allows you to generate and store network configuration and workload deployment intents in GraphDB.
![Intent Simulator](./Intent-Report-Simulator.png)

## Features

- Create State Reports (if an Intent is Received, Compliant, Degraded or Finalizing)
- Create Observation Reports (metric related to Conditions in the Intent Expectations)
- Randomly generate data between min/max values or using an input file with values
- Store generated intent reports in GraphDB or Prometheus
- View the last State report for Intents
- View the last Observation report for active generator tasks
- Store Prometheus query metadata in GraphDB for easy retrieval

## Storage Options

### GraphDB Storage (Default)
- Stores observation reports as Turtle format in GraphDB
- Maintains full semantic relationships and metadata

### Prometheus Storage
- Stores metrics in Prometheus via Pushgateway
- Automatically stores metadata in GraphDB for query retrieval
- Supports real-time monitoring and alerting
- Fallback to local file storage if Prometheus is unavailable

## Setup

1. Create and activate a Python virtual environment:
```bash
python -m venv intent-report-env
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment variables:
Create a `.env` file in the root directory with the following arguments and set to match your environment:
```
FLASK_APP=backend/app.py
FLASK_ENV=development
GRAPHDB_URL=http://localhost:7200
PROMETHEUS_URL=http://start5g-1.cs.uit.no:9090
PUSHGATEWAY_URL=http://start5g-1.cs.uit.no:9091
```

## Running the Application

1. Start the backend server:
```bash
export PYTHONPATH=$PYTHONPATH:.
flask run # optional add port like this --port 3003
```

2. Open your browser and navigate to `http://localhost:3000` (or other port number, if you changed it)

## Usage
- Select the report type for an intent (in the Create column)
- Set/select the characteristics of the Report in the Intent Report view that pops up.
- Choose storage type (GraphDB or Prometheus) for observation reports
- Click on the "Generate Report" button when all input fields have been set/selected.

## API Endpoints

### Core Endpoints
- `GET /api/query-intents` - Get all intents
- `GET /api/get-intent/<intent_id>` - Get specific intent
- `POST /api/generate-report` - Generate intent report
- `GET /api/get-last-intent-report/<intent_id>` - Get last report for intent
- `GET /api/active-tasks` - Get active observation tasks

### Prometheus Endpoints
- `GET /api/test-prometheus-connection` - Test Prometheus connectivity
- `GET /api/local-prometheus-metrics` - Get locally stored metrics
- `GET /api/prometheus-metadata/<condition_id>` - Get Prometheus query metadata (URL and readable format) for condition

## Prometheus Integration

When Prometheus storage is selected for observation reports:
1. Metrics are pushed to Prometheus Pushgateway
2. Metadata is stored in GraphDB with Prometheus query URLs
3. Query URLs can be retrieved via API for integration with monitoring tools

Example metadata stored:
```sparql
PREFIX data5g: <http://5g4data.eu/5g4data#>

INSERT DATA {
  GRAPH <http://intent-reports-metadata> {
    data5g:COc4f40964fc244ee7ae2c845e9f1e6b20
      data5g:hasPrometheusQuery <http://start5g-1.cs.uit.no:9090/api/v1/query?query=networklatency_coc4f40964fc244ee7ae2c845e9f1e6b20%7Bcondition_id%3D%22COc4f40964fc244ee7ae2c845e9f1e6b20%22%2Cintent_id%3D%22I5390ae21279f46c9b85c082867b8b9de%22%2Cjob%3D%22intent_reports%22%7D> ;
      data5g:hasReadableQuery "networklatency_coc4f40964fc244ee7ae2c845e9f1e6b20{condition_id=\"COc4f40964fc244ee7ae2c845e9f1e6b20\",intent_id=\"I5390ae21279f46c9b85c082867b8b9de\",job=\"intent_reports\"}" .
  }
}
```

The metadata includes both:
- **URL-encoded query**: For direct use in HTTP requests
- **Readable query**: Human-readable Prometheus query format