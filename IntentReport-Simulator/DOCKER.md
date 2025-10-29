# Docker Containerization Guide

This guide explains how to build and run the Intent Report Simulator as a Docker container.

## Building the Docker Image

From the `IntentReport-Simulator` directory:

```bash
docker build -t intent-report-simulator:latest .
```

## Running the Container

### Basic Run

```bash
docker run -d \
  --name intent-simulator \
  -p 5001:5001 \
  intent-report-simulator:latest
```

### With Custom Environment Variables

```bash
docker run -d \
  --name intent-simulator \
  -p 3004:3004 \
  -e PORT=3004 \
  -e GRAPHDB_URL=http://your-graphdb-host:7200 \
  -e GRAPHDB_REPOSITORY=intents-and-intent-reports \
  -e PROMETHEUS_URL=http://your-prometheus-host:9090 \
  -e PUSHGATEWAY_URL=http://your-pushgateway-host:9091 \
  -e INTENT_SIMULATOR_URL=http://your-intent-simulator:3004 \
  intent-report-simulator:latest
```

Example:
```bash
docker run -d \
  --name intent-simulator \
  -p 3004:3004 \
  -e PORT=3004 \
  -e GRAPHDB_URL=http://start5g-1.cs.uit.no:7200 \
  -e GRAPHDB_REPOSITORY=intents-and-intent-reports \
  -e PROMETHEUS_URL=http://start5g-1.cs.uit.no:9090 \
  -e PUSHGATEWAY_URL=http://start5g-1.cs.uit.no:9091 \
  -e INTENT_SIMULATOR_URL=http://start5g-1.cs.uit.no:3004 \
  intent-report-simulator:latest
```

