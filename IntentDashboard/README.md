# Use Grafana as Dashboard
Let us try to use Grafana as a Dashboard to visualize what is going on with Intents (i.e. How many Intents are there in total, how many are in different states, etc.)
## Start 
```
# start grafana
docker run -d -p 3000:3000 --name=grafana \
  --volume grafana-storage:/var/lib/grafana \
  grafana/grafana-enterprise
```

## Add datasource
We need to add GraphDB as a datasource. There is a SPARQL plugin that we can use for that. It will send SPARQL queries to a GraphDB server and make the result of the query available to be visualized in Grafana.

## Dashboards
