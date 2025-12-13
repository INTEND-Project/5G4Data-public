# Intent Report Simulator

A simulator for generating TM Forum formatted intent reports for the 5G4DATA use case.

![Intent Report Simulator](./Intent-Report-Simulator.png)

## What is the Intent Report Simulator?

The Intent Report Simulator is a web-based application that generates and manages intent reports for intents. It provides:

- **State Reports**: Generate reports indicating if an Intent is Received, Compliant, Degraded, or Finalizing
- **Observation Reports**: Create metric-related reports for Conditions in Intent Expectations
- **Flexible Data Generation**: Randomly generate data between min/max values or use input files with predefined values
- **Multiple Storage Options**: Store generated intent reports in GraphDB or Prometheus
- **Report Viewing**: View the last State report for Intents and the last Observation report for active generator tasks
- **Prometheus Integration**: Store Prometheus query metadata in GraphDB for easy retrieval

## Storage Options

### GraphDB Storage (Default)
- Stores observation reports as Turtle format in GraphDB
- Maintains full semantic relationships and metadata

### Prometheus Storage
- Stores metrics in Prometheus via Pushgateway
- Automatically stores metadata in GraphDB for query retrieval
- Supports real-time monitoring and alerting
- Fallback to local file storage if Prometheus is unavailable

## Quick Start with Docker

The easiest way to run the Intent Report Simulator is using Docker.

### Prerequisites

- Docker installed on your system
- Access to GraphDB (if using GraphDB storage)
- Access to Prometheus and Pushgateway (if using Prometheus storage)

### Building the Docker Image

**Important**: The Dockerfile requires access to both `IntentReport-Simulator/` and `intent-report-client/` directories, so you must build from the **parent directory** (`5G4Data-public/`):

```bash
cd /path/to/5G4Data-public
docker build -t intent-report-simulator:latest -f IntentReport-Simulator/Dockerfile .
```

Alternatively, if you're already in the `IntentReport-Simulator` directory:

```bash
docker build -t intent-report-simulator:latest -f Dockerfile ..
```

### Running the Container

#### Basic Run

Run the simulator with default settings:

```bash
docker run -d \
  --name intent-report-simulator \
  -p 3005:3005 \
  intent-report-simulator:latest
```

The simulator will be available at `http://localhost:3005`

**Note**: If GraphDB is running on the same host, you may need to use `--network host` or set `GRAPHDB_URL` to access the host's services:

```bash
# Option 1: Use host network (Linux only)
docker run -d \
  --name intent-report-simulator \
  --network host \
  -e DISABLE_INTENT_GENERATION=true \
  intent-report-simulator:latest

# Option 2: Use host.docker.internal or localhost IP
docker run -d \
  --name intent-report-simulator \
  -p 3005:3005 \
  -e GRAPHDB_URL=http://host.docker.internal:7200 \
  -e DISABLE_INTENT_GENERATION=true \
  intent-report-simulator:latest
```

#### Disable Intent Generation

To prevent the simulator from automatically creating intents when none are found:

```bash
docker run -d \
  --name intent-report-simulator \
  -p 3005:3005 \
  -e DISABLE_INTENT_GENERATION=true \
  intent-report-simulator:latest
```

#### With Custom Environment Variables

To configure GraphDB, Prometheus, or other services, use environment variables:

```bash
docker run -d \
  --name intent-report-simulator \
  -p 3005:3005 \
  -e GRAPHDB_URL=http://your-graphdb-host:7200 \
  -e GRAPHDB_REPOSITORY=intents-and-intent-reports \
  -e PROMETHEUS_URL=http://your-prometheus-host:9090 \
  -e PUSHGATEWAY_URL=http://your-pushgateway-host:9091 \
  -e DISABLE_INTENT_GENERATION=true \
  intent-report-simulator:latest
```

#### Example with Specific Configuration

```bash
docker run -d \
  --name intent-report-simulator \
  -p 3005:3005 \
  -e GRAPHDB_URL=http://start5g-1.cs.uit.no:7200 \
  -e GRAPHDB_REPOSITORY=intents-and-intent-reports \
  -e PROMETHEUS_URL=http://start5g-1.cs.uit.no:9090 \
  -e PUSHGATEWAY_URL=http://start5g-1.cs.uit.no:9091 \
  intent-report-simulator:latest
```

### Docker Management Commands

- **View logs**: `docker logs intent-report-simulator`
- **Follow logs**: `docker logs -f intent-report-simulator`
- **View last N lines**: `docker logs --tail 100 intent-report-simulator`
- **View logs with timestamps**: `docker logs -t intent-report-simulator`
- **Stop container**: `docker stop intent-report-simulator`
- **Start container**: `docker start intent-report-simulator`
- **Remove container**: `docker rm intent-report-simulator`
- **Restart container**: `docker restart intent-report-simulator`

### Environment Variables

The following environment variables can be configured:

| Variable | Description | Default |
|----------|-------------|---------|
| `GRAPHDB_URL` | URL of the GraphDB instance | `http://start5g-1:7200` |
| `GRAPHDB_REPOSITORY` | GraphDB repository name | `intent-reports` |
| `PROMETHEUS_URL` | URL of the Prometheus instance | - |
| `PUSHGATEWAY_URL` | URL of the Prometheus Pushgateway | - |
| `DISABLE_INTENT_GENERATION` | Disable automatic intent creation when no intents found | `false` |
| `FLASK_ENV` | Flask environment (production/development) | `production` |
| `PORT` | Application port (internal) | `5001` |

**Note**: The container exposes port 3005, so always map to port 3005 when using `-p` flag.

## Usage

Once the simulator is running:

1. Open your browser and navigate to `http://localhost:3005`
2. Select the report type for an intent (in the Create column)
3. Set/select the characteristics of the Report in the Intent Report view that pops up
4. Choose storage type (GraphDB or Prometheus) for observation reports
5. Click on the "Generate Report" button when all input fields have been set/selected

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

## Local Development Setup

If you prefer to run the simulator locally without Docker:

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
Create a `.env` file in the root directory:
```
FLASK_APP=app.py
FLASK_ENV=development
GRAPHDB_URL=http://localhost:7200
PROMETHEUS_URL=http://start5g-1.cs.uit.no:9090
PUSHGATEWAY_URL=http://start5g-1.cs.uit.no:9091
```

4. Start the backend server:

**Option A: Using Flask (recommended for development)**
```bash
export PYTHONPATH=$PYTHONPATH:.
flask run --port 3005
```

**Option B: Using Python directly**
```bash
export PYTHONPATH=$PYTHONPATH:.
python app.py --port 3005
```

To disable automatic intent generation when running directly:
```bash
python app.py --disable-intent-generation --port 3005
```

Or use the shorter alias:
```bash
python app.py --no-create-intents --port 3005
```

5. Open your browser and navigate to `http://localhost:3005`

## Viewing Logs

The simulator logs important information including the complete Turtle format of all generated reports. This is useful for debugging and understanding the exact format of data being stored in GraphDB.

### Docker Logs

**View all logs:**
```bash
docker logs intent-report-simulator
```

**Follow logs in real-time:**
```bash
docker logs -f intent-report-simulator
```

**View last 100 lines:**
```bash
docker logs --tail 100 intent-report-simulator
```

**View logs with timestamps:**
```bash
docker logs -t intent-report-simulator
```

**Filter logs for Turtle format reports:**
```bash
docker logs intent-report-simulator | grep -A 50 "=== Generated Intent Report"
```

**Filter logs for specific intent:**
```bash
docker logs intent-report-simulator | grep "Intent ID: I5390ae21279f46c9b85c082867b8b9de"
```

### Local Development Logs

When running directly with Python, logs are output to the console. The logging level is set to INFO by default, which includes:
- Intent generation activities
- Report generation with complete Turtle format
- GraphDB operations
- Error messages with stack traces

**To see debug-level logs**, you can modify the logging level in `app.py` or set the environment variable:
```bash
export LOG_LEVEL=DEBUG
python app.py
```

### What Gets Logged

The simulator logs the following information:

1. **Intent Reports (Turtle Format)**: Complete Turtle representation of all generated reports
   - State Change reports
   - Update Change reports
   - Observation reports
   - Format: Logged with clear markers `=== Generated Intent Report (Turtle Format) ===`

2. **Intent Data (Turtle Format)**: Complete Turtle representation of intents retrieved from GraphDB
   - Format: Logged with markers `=== Retrieved Intent (Turtle Format) ===`

3. **GraphDB Operations**: Success/failure of storing reports
   - Storage responses
   - Query results

4. **Observation Generation**: Details about observation tasks
   - Task IDs
   - Condition IDs
   - Frequency and time ranges

5. **Errors**: Full error messages with stack traces for debugging

### Example Log Output

```
2024-01-15 10:30:45 - INFO - === Generated Intent Report (Turtle Format) ===
2024-01-15 10:30:45 - INFO - Report Type: STATE_CHANGE
2024-01-15 10:30:45 - INFO - Intent ID: I5390ae21279f46c9b85c082867b8b9de
2024-01-15 10:30:45 - INFO - Turtle Data:
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix data5g: <http://5g4data.eu/5g4data#> .
...
2024-01-15 10:30:45 - INFO - === End of Turtle Format ===
```

## Troubleshooting

### Container won't start
- Check logs: `docker logs intent-report-simulator`
- Verify port 3005 is not already in use
- Ensure Docker has sufficient resources

### Cannot connect to GraphDB
- **If GraphDB is on the same host as Docker:**
  - Use `--network host` flag: `docker run --network host ...`
  - Or set `GRAPHDB_URL=http://host.docker.internal:7200` (Mac/Windows)
  - Or set `GRAPHDB_URL=http://172.17.0.1:7200` (Linux Docker bridge gateway)
  - Or set `GRAPHDB_URL=http://localhost:7200` when using `--network host`
- **If GraphDB is on a different host:**
  - Use the actual hostname or IP address: `GRAPHDB_URL=http://graphdb-host:7200`
  - Ensure the hostname is resolvable from within the container
  - Check firewall rules allow connections from Docker containers
- Verify `GRAPHDB_URL` is correct and accessible from the container
- Test connectivity: `docker exec intent-report-simulator curl http://your-graphdb-url:7200`
- Ensure the GraphDB repository exists
- Check logs for connection errors: `docker logs intent-report-simulator | grep -i graphdb`

### Prometheus connection issues
- Verify `PROMETHEUS_URL` and `PUSHGATEWAY_URL` are correct
- Check that Prometheus and Pushgateway are running and accessible
- The simulator will fallback to local file storage if Prometheus is unavailable
- Check logs for Prometheus errors: `docker logs intent-report-simulator | grep -i prometheus`

### Preventing automatic intent creation
- By default, the simulator will automatically create intents from `intent-generation.json` if no intents are found in GraphDB
- To disable this behavior:
  - **Docker**: Set `DISABLE_INTENT_GENERATION=true` environment variable
  - **Direct execution**: Use `--disable-intent-generation` or `--no-create-intents` CLI argument
- When disabled, the simulator will return an empty list or error message instead of creating intents
- Check logs to see if intents were generated: `docker logs intent-report-simulator | grep -i "intent generation"`

