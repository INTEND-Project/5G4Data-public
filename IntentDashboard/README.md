# Use Grafana as Dashboard
Let us try to use Grafana as a Dashboard to visualize what is going on with Intents (i.e. How many Intents are there in total, how many are in different states, etc.)
## Start 
```
# start grafana
docker run -d --network=host --name=grafana   -e GF_SERVER_HTTP_PORT=3001   grafana/grafana-enterprise
```
Make sure that the port is accessible from outside (i.e. configure your firewall to allow access. e.g. sudo ufw allow from 85.165.51.159 to any port 3001)

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
