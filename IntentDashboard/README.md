# Install Grafana
The easiest way to run the [Open Source version of Grafana](https://grafana.com/grafana/download?pg=oss-graf&plcmt=hero-btn-1&platform=docker) is to just run the docker image:
```
docker run -d --network=host --name=grafana -e GF_SERVER_HTTP_PORT=3001 grafana/grafana-enterprise
```
Make sure that the port is accessible from outside (i.e. configure your firewall to allow access. e.g. sudo ufw allow from 85.165.51.159 to any port 3001)

# Use Grafana as Dashboard
Let us try to use Grafana as a Dashboard to visualize what is going on with Intents (i.e. How many Intents are there in total, how many are in different states, etc.)

## Add datasource
We need to add GraphDB as a datasource. There is a SPARQL plugin that we can use for that. It will send SPARQL queries to a GraphDB server and make the result of the query available to be visualized in Grafana.
![SPARQL plugin configuration](./SPARQL-plugin-config.png)

## Dashboards
Panels in the Dashboard can use the graphdb datasource as shown in the figure by refering to it like this:
```
        "datasource": {
          "type": "sparql",
          "uid": "graphdb"
        },

```

# Example dashboards
We have provided a couple of example Dashboards:

<dl>
  <dt><strong>TMForum Intent Dashboard</strong></dt>
  <dd>This Dashboard shows Intent statistics (how many intents in total, how many of each type, their targets and #deployments to each edge datacenter. It also contains a clickable list of intents showing the current TM Forum State and if clicked shows more details (see next Dashboard description).</dd>
  <dt><strong>Intent and Condition Metrics Timeseries Dashboard</strong></dt>
  <dd>This Dashboard shows detailed observation metrics in timeseries graphs for each condition in the selected intent. Dotted threshold lines are also displayed in the graphs based on the quan:function used in the condition.</dd>
</dl>

The json representation of the dashboards can be imported to a Grafana server.

## TMForum Intent Dashboard
![TMForum Intent Dashboard](./TMForum-Intent-Dashboard.png)

## Intent and Condition Metrics Timeseries Dashboard
![Intent and Condition Metrics Timeseries Dashboard](./Intent-and-Condition-Metrics-Timeseries-Dashboard.png)
