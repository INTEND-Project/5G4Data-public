# INTEND 5G4DATA Workload Catalog
This is the INTEND 5G4DATA use case Workload catalog. It will be used by inChat or inSwitch to find workloads that the user wants to deploy to edge datacenters. The catalogue contains helm charts that can be referenced in Intent Expectations for workload deployment.

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