# inSwitch workflow
The starting point for inSwitch will be what it receives from inChat. This means that the complexity of inSwitch will be decided by what inChat does. If we assume that inSwitch receives some sort of business level intent, then inSwitch will have to transform the business level intent into one or more resource level intents that is in turn sent to inNet and inOrch using the TM Forum management API. The resource level intents will use the intent templates we have described to create the resource level intents.

## Filling in resource level intent templates
The templates requires that the QoS parameters for **network** related intents are filled in into the network intent template. These numbers (for the MVS) are:
 - latency requirement (***5g4data:5GTelenorLatency***)
 - bandwidth requirement (***5g4data:5GTelenorBandwidth***)
 - Area where the slice is required (***geo:Polygon***)

The template for **deployment** of workload requires that these attributes are established:
 - Required compute latency (***5g4data:ComputeLatency***, in ms)
 - Data center that the workload should be deployed to (***5g4data:DataCenter***, uniq edge datacenter ID, e.g. "EC_10")
 - Identification of the workload (***5g4data:Application***, uniq id, from workload catalogue, e.g. AR-retail-app)
 - Deployment description (***5g4data:DeploymentDescriptor***, e.g. "http://intend.eu/5G4DataWorkloadCatalogue/ar-retail-app-deployment.yaml")

 ## Finding the 5g4data:xxxxxx and geo:polygon values
 How will the needed values that is part of the intent templates found? Some of them will be "common knowledge" that can be retrieved using large language models and some of them can be calculated based on the synthetic data we have provided about the infrastructure (resides in the knowledge graph). Others might be retrieved through a dialogue with the customer (inChat). Exactly how to do this is left to the tool owners to find out.

> **⚠️ NOTE:**  
> The 5g4data:xxxxxx names is a 5G4DATA use case extension of the TM Forum Intent ontology.
