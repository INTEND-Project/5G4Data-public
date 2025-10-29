# Docker Deployment Guide

This guide explains how to build and run the Intent Simulator as a Docker container.

## Prerequisites

- Docker installed on your system
- OpenAI API key
- Network access to the GraphDB instance

## Environment Variables

The application requires the following environment variables:

- `GRAPHDB_URL`: URL of the GraphDB instance (default: `http://localhost:7200`)
- `GRAPHDB_REPOSITORY`: Repository name in GraphDB (default: `intents`)
- `OPENAI_API_KEY`: Your OpenAI API key for generating region polygons

## Build from parent directory
The Intent-Sumulator uses the ../intent-generator-package and therefore, the build process needs to be done from the parent directory.

```bash
cd /home/telco/arneme/INTEND-Project/5G4Data-public
docker build -f Intent-Simulator/Dockerfile -t intent-simulator:latest .
```

This approach properly includes the `intent-generator-package` directory in the build context.

## Running the Container

### Basic Run

```bash
docker run -d \
  -p 3004:3004 \
  -e GRAPHDB_URL=http://localhost:7200 \
  -e GRAPHDB_REPOSITORY=intents \
  -e OPENAI_API_KEY=your-api-key-here \
  -v $(pwd)/intents:/app/intents \
  --name intent-simulator \
  intent-simulator:latest
```

### With Custom Environment File

Create a `.env.docker` file:
```
GRAPHDB_URL=http://your-graphdb-host:7200
GRAPHDB_REPOSITORY=intents
OPENAI_API_KEY=sk-proj-xxxxxxxxx
```

Then run:
```bash
docker run -d \
  -p 3004:3004 \
  --env-file .env.docker \
  -v $(pwd)/intents:/app/intents \
  --name intent-simulator \
  intent-simulator:latest
```

### Connecting to GraphDB on Host Machine

If GraphDB is running on the host machine:

```bash
docker run -d \
  -p 3004:3004 \
  -e GRAPHDB_URL=http://host.docker.internal:7200 \
  -e GRAPHDB_REPOSITORY=intents \
  -e OPENAI_API_KEY=your-api-key-here \
  -v $(pwd)/intents:/app/intents \
  --name intent-simulator \
  intent-simulator:latest
```

**Note:** `host.docker.internal` is a special DNS name that resolves to the host machine's IP address from within the container. On Linux, you may need to add `--add-host=host.docker.internal:host-gateway` flag.

### For Linux Hosts

```bash
docker run -d \
  -p 3004:3004 \
  --add-host=host.docker.internal:host-gateway \
  -e GRAPHDB_URL=http://host.docker.internal:7200 \
  -e GRAPHDB_REPOSITORY=intents \
  -e OPENAI_API_KEY=your-api-key-here \
  -v $(pwd)/intents:/app/intents \
  --name intent-simulator \
  intent-simulator:latest
```

## Container Management

### View Logs

```bash
docker logs intent-simulator
docker logs -f intent-simulator  # Follow logs in real-time
```

### Stop the Container

```bash
docker stop intent-simulator
```

### Start the Container

```bash
docker start intent-simulator
```

### Remove the Container

```bash
docker stop intent-simulator
docker rm intent-simulator
```

### Access the Container Shell

```bash
docker exec -it intent-simulator /bin/bash
```

## Persistent Storage

The `intents` directory is mounted as a volume to persist generated intent files across container restarts:

- Host path: `./intents`
- Container path: `/app/intents`

Generated intent files (`.ttl` files) will be stored on the host machine and persist even if the container is removed.

## Network Configuration

### Mapping Port

- Container port: `3004`
- Host port: `3004` (configurable with `-p` flag)

Example to map to different host port:
```bash
docker run -p 8080:3004 ...
```

### Firewall Configuration

If accessing from external IPs, ensure the firewall allows connections:

```bash
sudo ufw allow 3004/tcp
# Or restrict to specific IPs
sudo ufw allow from 80.212.132.31 to any port 3004 comment "Access to intent simulator"
```

## Health Check

### Check if the service is running

```bash
curl http://localhost:3004/
```

### Check API endpoint

```bash
curl http://localhost:3004/api/query-intents
```

## Troubleshooting

### Container Exits Immediately

Check logs:
```bash
docker logs intent-simulator
```

Common issues:
- Missing environment variables
- GraphDB connection issues
- Port already in use

### Cannot Connect to GraphDB

1. Verify GraphDB is running: `curl http://localhost:7200`
2. Check network connectivity from container:
   ```bash
   docker exec intent-simulator curl http://host.docker.internal:7200
   ```
3. For Linux, ensure `--add-host=host.docker.internal:host-gateway` is used

### Port Already in Use

Change the host port mapping:
```bash
docker run -p 3005:3004 ...
```

### Rebuild After Code Changes

```bash
docker stop intent-simulator
docker rm intent-simulator
docker build -t intent-simulator:latest .
docker run ...  # same command as before
```

## Application Access

Once running, access the application at:
- Local: `http://localhost:3004`
- Remote: `http://start5g-1.cs.uit.no:3004`

## Gunicorn Configuration

The application runs with Gunicorn for production use:

- **Workers**: 2
- **Timeout**: 120 seconds
- **Bind**: 0.0.0.0:3004 (accepts connections from all interfaces)

This configuration is set in the Dockerfile's CMD instruction.

## Advanced: Using Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  intent-simulator:
    build:
      context: ..
      dockerfile: Intent-Simulator/Dockerfile
    ports:
      - "3004:3004"
    environment:
      - GRAPHDB_URL=${GRAPHDB_URL:-http://host.docker.internal:7200}
      - GRAPHDB_REPOSITORY=${GRAPHDB_REPOSITORY:-intents}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./intents:/app/intents
    restart: unless-stopped
```

Then run:
```bash
docker-compose up -d
```

## Image Management

### List Images

```bash
docker images | grep intent-simulator
```

### Remove Image

```bash
docker rmi intent-simulator:latest
```

### Tag for Remote Repository

```bash
docker tag intent-simulator:latest your-registry/intent-simulator:latest
docker push your-registry/intent-simulator:latest
```

