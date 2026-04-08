# avalance-object-detection

Mock-up workload Helm chart for object detection from avalanche-overview drone footage.

## Push chart to workload catalog

From this directory do:

The ChartMuseum url override is optional (default shown):

```bash
CHARTMUSEUM_URL=http://your-chartmuseum-host:3040 ./build-and-push.sh
```

The script will:
- increment patch version in `helm/avalance-object-detection/Chart.yaml`
- package the chart
- upload it to `${CHARTMUSEUM_URL}/api/charts`
