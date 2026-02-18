# INTEND 5G4DATA Workload Catalog
This is the INTEND 5G4DATA use case Workload catalog. It will be used by inChat or inSwitch to find workloads that the user wants to deploy to edge datacenters. The catalogue contains helm charts that can be referenced in Intent Expectations for workload deployment.

## Starting the Workload Catalog

The workload catalog consists of two services running via Docker Compose:
- **chartmuseum**: A Helm chart repository server (port 8080 internally)
- **workloads**: A Go Fiber web application providing the catalog UI and API (port 3040 externally)

### Prerequisites
- Docker and Docker Compose installed

### Starting the services

1. Navigate to the Workload-Catalog directory:
   ```bash
   cd Workload-Catalog
   ```

2. Start the services using Docker Compose:
   ```bash
   docker-compose up -d
   ```

3. The workload catalog will be available at:
   - **Web UI**: http://localhost:3040
   - **Helm API**: http://localhost:3040 (for helm repo add)

### Stopping the services

```bash
docker-compose down
```

### Viewing logs

```bash
docker-compose logs -f
```

## Helm usage of workload catalogue
Helm can be configured to use the workload catalogue as chart repository like this:
```bash
helm repo add workloads http://start5g-1.cs.uit.no:3040/
```

It is then possible to list workloads in the repo like this:
```bash
helm search repo workloads
```

It is also possible to pull charts like this:
```bash
helm pull workloads/AR-Retail-app-chart
```

This can be used by inServ. The helm charts will reference an image (or several images), and we also need to store the images somewhere. Using ghrc or docker hub is an option, but [Harbor](https://goharbor.io/) could also have been used. Harbor has an internal chartmuseum for helm charts, and Harbor can therefore store both charts and images. Harbor is however a bit "heavy" and we have for now decided to just use charmuseum (for charts) and ghrc or docker hub for images. In a real world scenario Harbor would be the right choice.