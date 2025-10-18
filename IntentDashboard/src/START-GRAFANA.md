# INTEND project example dashboards for the 5G4Data use-case
As part of the INTEND project, we have created a few example Grafana dashboards that can be used to view details related to intents and intent reports (both status and observations of condition metrics related to the intent). You will need a running Grafana server to use the example dashboards, and we will here give you instructions on how to install and configure Grafana and how you can load the example dashboards.

# Start and configure Grafana
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

You should now be able to access the Dashboard using this [url](http://start5g-1.cs.uit.no:3002/). Login using user *admin* and the *password* you used.

## Install Grafana data sources and start the data source proxy
Before you load the INTEND project dashboards, you will have to install two data source plugins. Click on the Grafana icon in upper left corner and select *Data sources*. Click on *Add data source*, scroll all the way down on the page that appears and click on *Find more data source plugins*. In the search box, type *sparql* and click on the *SPARQL* plugin that appears. Click on *Install* in the upper left corner. When the installation is complete, click on *Add new datasource* and add *http://start5g-1.cs.uit.no:7200/repositories/intents_and_intent_reports* as the Source (do not add anything in *Username* and *Password*). Click *Save & test"*. The test should succeed if your GraphDB server is running. 

Click on the Grafana icon in upper left corner again and select *Data sources*. Click on *Add data source*, scroll all the way down on the page that appears and click on *Find more data source plugins*. In the search box, type *infinity* and click on the *Infinity* plugin that appears. Click on *Install* in the upper left corner. When the installation is complete, click on *Add new datasource* and click *Save & test"*. The health check should succeed.

Your Grafana instance is now ready to import the INTEND project example dashboards, but the dashboards uses the INTEND project **IntentReportQueryProxy**, so you will have to start the proxy first. More details about the proxy can be found [here](https://github.com/INTEND-Project/5G4Data-public/tree/main/IntentReportQueryProxy).

## Load the INTEND project Dashboards.
After you have logged in, click on the Grafana icon in upper left corner and select *Dashboards*. Click on drop down **New** button in the upper right corner and select *Import*. You can now either uplad a file or add the dashboard JSON model directly. You will find the INTEND project example dashboards [here](https://github.com/INTEND-Project/5G4Data-public/tree/main/IntentDashboard/src). Either download the files first and use the *Upload file* option or just copy the JSON content directly. You should start with the *TMForumIntentDashboardAnotherInstance.json* since the *IntentAndConditionMetricsTimeseriesDashboardAnotherInstance.json* depends on it. When you load the TM Forum Intent Dashboard you will be asked to select a datasource. Select the SPARQL data source that we have just configured. The Dashboard should now render successfully.

## Stop the container
```
docker stop grafana-3002
```
If you want to restart the container later you can start it again like this:
```
docker start grafana-3002
```
All dashboards and other configurations you have done will still be there as you left it :-)

## Remove the docker container and the docker volume
```
# Remove the container
docker rm grafana-3002

# Remove the volume
docker volume rm grafana-3002-data
```
This removes both the container and the image and thus all traces are gone (i.e. you cannot start it again)