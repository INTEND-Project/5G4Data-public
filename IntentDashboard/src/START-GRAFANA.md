# INTEND project example dashboards for the 5G4Data use-case
As part of the INTEND project, we have created a few example Grafana dashboards that can be used to view details related to intents and intent reports (both status and observations of condition metrics related to the intent). You will need a running Grafana server to use the example dashboards, and we will here give you instructions on how to install and configure Grafana and how you can load the example dashboards. **Note that the DatacentersAnotherInstanceQueryGeojson.json dashboard requires a modified Grafana docker container. More about this at the end of this file.**

# Start and configure Grafana (this is the standard version and DatacentersAnotherInstanceQueryGeojson.json will not work)
The easiest way to run Grafana is to use the Grafana Docker container. The following instructions have been used with success with the Grafana v11.6.0 docker container.

Before you execute the **docker run** command, edit the "set-password-here" to be the password you want to use. If you want to run Grafana on a different port, change 3001 to the port you want to use (note: edit two places in the docker run command)

```
## Create a docker volume for the container
docker volume create grafana-data

## Start the Grafana container
docker run -d --network=host --name=grafana -e GF_SERVER_HTTP_PORT=3001 -e GF_SERVER_HTTP_ADDR=0.0.0.0 -e GF_SECURITY_ADMIN_PASSWORD='set-password-here' -e GF_SERVER_ROOT_URL=http://localhost:3001/ -v grafana-data:/var/lib/grafana grafana/grafana-enterprise
```

## Allow incoming traffic
How to allow incoming traffic to the Grafana server you have started depends highly on how your host server is set up. The explanation here only works if you are using **ufw** as your firewall, and in most cases that will probably not be the case. We have included this description here just to remind ourselves on how our lab server needs to be configured.

To access Grafana from a remote machine, add this to the firewall, but before you issue the command, substitute *ipv4-address* with the local machines ipv4 address (e.g. 80.123.456.78):
```
sudo ufw allow from ipv4-address to any port 7200 comment "Access from 80.123.456.78 to GraphDB"
```

You should now be able to access the Dashboard using this [url](http://start5g-1.cs.uit.no:3001/). Login using user *admin* and the *password* you used.

## Install Grafana data sources and start the data source proxy
Before you load the INTEND project dashboards, you will have to install two data source plugins. Click on the Grafana icon in upper left corner and select *Data sources*. Click on *Add data source*, scroll all the way down on the page that appears and click on *Find more data source plugins*. In the search box, type *sparql* and click on the *SPARQL* plugin that appears. Click on *Install* in the upper left corner. When the installation is complete, click on *Add new datasource* and add *http://start5g-1.cs.uit.no:7200/repositories/intents_and_intent_reports* as the Source (do not add anything in *Username* and *Password*). Click *Save & test"*. The test should succeed if your GraphDB server is running. 

Click on the Grafana icon in upper left corner again and select *Data sources*. Click on *Add data source*, scroll all the way down on the page that appears and click on *Find more data source plugins*. In the search box, type *infinity* and click on the *Infinity* plugin that appears. Click on *Install* in the upper left corner. When the installation is complete, click on *Add new datasource* and click *Save & test"*. The health check should succeed.

Your Grafana instance is now ready to import the INTEND project example dashboards, but the dashboards uses the INTEND project **IntentReportQueryProxy**, so you will have to start the proxy first. More details about the proxy can be found [here](https://github.com/INTEND-Project/5G4Data-public/tree/main/IntentReportQueryProxy).

## Load the INTEND project Dashboards.
After you have logged in, click on the Grafana icon in upper left corner and select *Dashboards*. Click on drop down **New** button in the upper right corner and select *Import*. You can now either uplad a file or add the dashboard JSON model directly. You will find the INTEND project example dashboards [here](https://github.com/INTEND-Project/5G4Data-public/tree/main/IntentDashboard/src). Either download the files first and use the *Upload file* option or just copy the JSON content directly. You should start with the *TMForumIntentDashboardAnotherInstance.json* since the *IntentAndConditionMetricsTimeseriesDashboardAnotherInstance.json* depends on it. When you load the TM Forum Intent Dashboard you will be asked to select a datasource. Select the SPARQL data source that we have just configured. The Dashboard should now render successfully.

## Stop the container
```
docker stop grafana
```
If you want to restart the container later you can start it again like this:
```
docker start grafana
```
All dashboards and other configurations you have done will still be there as you left it :-)

## Remove the docker container and the docker volume
```
# Remove the container
docker rm grafana

# Remove the volume
docker volume rm grafana-data
```
This removes both the container and the image and thus all traces are gone (i.e. you cannot start it again)

# Modified Grafana docker container
We wanted to show the polygons that defines the regions that network slices are activated for in the map. Unfortunately the Grafana geomap plugin (which is an intrinsic part of Grafana, i.e. a built in plugin) does not support rendering of geojson poligons from queries. Since our slice polygons are part of network and combined network and deployment intents and stored in GraphDB, we needed to modify the built in geomap plugin. This is what you need to do to add this functionality to Grafana:
```
# Clone Grafana open source code
git clone https://github.com/grafana/grafana.git
# Add these files from this folder to the cloned Grafana sourcecode:
cp geojsonQuery.ts grafana/public/app/plugins/panel/geomap/layers/data/geojsonQuery.ts
cp index.ts grafana/public/app/plugins/panel/geomap/layers/data/index.ts
docker build -t grafana/grafana:dev .
```
You should now have a docker image with the modified grafana geomap plugin. Run Grafana from this container. Here is an example command on how to do that:
```
# Create a volume for Grafana data
docker volume create grafana-dev-data
# Run grafana. If you want to run it on grafana standard port (3000),
# just remove the -e GF_SERVER_HTTP_PORT=3002 argument
# Change your-password-here with a password of your choice
# Note that -e "GF_PANELS_ENABLE_ALPHA=true" must be set to use the add on we created
docker run -d --network=host --name=grafana-dev -e GF_SERVER_HTTP_PORT=3002 -e GF_SERVER_HTTP_ADDR=0.0.0.0 -e "GF_PANELS_ENABLE_ALPHA=true" -e GF_SECURITY_ADMIN_PASSWORD='your-password-here' -e GF_SERVER_ROOT_URL=http://localhost:3002/ -v grafana-dev-data:/var/lib/grafana   grafana/grafana:dev
```
The *DatacentersAnotherInstanceQueryGeojson.json* will now work when you import it.