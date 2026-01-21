# Voiceover for end-to-end video snippet:
This is text used to generate the different audio tracks for the 5G4Data inServ video snippet (part of a larger video). We have used [EllevenLabs text-to-speech](https://elevenlabs.io/app/speech-synthesis/text-to-speech ) to generate the audio. The follwoing settings have been used in Ellevenlabs:
Voice: Arne´s voice (created using Ellevenlabs [instance voice clone feature](https://elevenlabs.io/app/voice-library?action=create&creationType=cloneVoice)):
- Model: Eleven Multilingual V2
- Speed: 1.15
- Stability: 45%
- Similarity: 100%
- Style aggregation: 0%
- Languague override: Off
- Speaker boost: On

The generated audio was created in multiple snippets, one for each of the following subheadings to make it easier to align it with the video content.

## inServ intent animation
### inChat to inServ 1
So, inChat uses a large language model in addition to use-case specific knowledge from inGraph. The use-case specific knowledge in inGraph describes the infrastructure, the avaialble workloads and the geographical areas that could be used to configure geographical aware 5G slices. The use case specific knowledge is used to generate the formal intent specification in TM Forum format.

### inChat to inServ 2
When the TM Forum formatted intent is complete, it is sent to inServ in in its turtle format representation.

### inChat to inServ 3
If the intent contains multiple expectations — in other words, both a deployment requirement and a network configuration requirement — inServ splits the intent into separate components.

### inServ to inOrch and inNet

The deployment intent is sent to inOrck in the datacenter specified in the intent.
Here, the application is deployed and monitored using the metrics defined in the knowledge graph.

At the same time, the network intent is sent to inNet.
inNet configures the required 5G slice, using the geographical polygons and network topology to constrain the slice to the correct area.

## Grafana and inServ log voiceover

Since inServ is the handler of the intent it will store the intent in inGraph when it is received. We can see that this happens in the live observational twin Grafana dashboard, and we can see in the inServ log that the intent was received and that it was split into one deployment intent and one network intent. 

The deployment intent is sent to inOrck running in datacenter EC21, since this was stated as part of the intent. 

The network intent is sent to the single instance of inNet. 

Note that the splitted intents will have new unique identifiers. This is important for the management of intents and their related status reports and metrics observations.

## inOrch animation voiceover
### inOrch animation voiceover 1
Each inOrck instance is responsible for deployment, monitoring and scaling of workloads in its respective datacenter. inOrck consists of several components and all the components run in a Kubernetes cluster. 

inOrck uses the inGraph knowledge graphs to locate and download the Helm chart needed to deploy the workload as described in the intent.

### inOrch animation voiceover 2
The inOrck-TMF-Proxy component implements the TM Forum 921 API and when a deployment intent is sent from inServ, the proxy will parse and analyse the intent. The intent describes where the Helm chart that should be used to deploy the intent is located, and the Helm chart is downloaded and the deplyment is done accordingly to a separate namespace in the cluster. 

### inOrch animation voiceover 3

The proxy then transforms the TM Forum intent into an Intel Intent Driven Orchestrator compliant intent and the orchestrator will notify the orchestrator about its existence by issuing the complient intent to it.

### inOrch animation voiceover 4

The orchestrator informs the Planner about the new workload and a scheduler for the workload is created.

### inOrch animation voiceover 5

The workloads will store its KPI metrics in its accompanying Prometheus component and the Planner and Scheduler can observe the metrics and make scaling adjustment to keep the workload within its intented performance requirements.

## Epilogue
Throughout this process, although not shown in this animation, all intents, state changes, and observations are stored in the intents knowledge graph.
This allows the system to track whether intents are fulfilled and to react automatically if performance targets are not met.

In this way, natural language input is transformed into coordinated actions across compute, network, and geography — enabling automated, intent-driven 5G service provisioning and workload deployments to local datacenters for the serving area.

## Unused (so far)
Let’s take a closer look at how knowledge and intent come together in the 5G4Data use case, and how the INTEND tools handle the intent.

The process begins with the user. The user describes their needs in natural language, and through a dialogue, inChat deduces where a service should run, what performance it should achieve, and in which geographical area it should be available. inChat then generates a formal intent in TM Forum format. To do this, it combines two sources of knowledge.

First, common knowledge from a large language model to understand the request.
Second, use-case–specific knowledge from multiple knowledge graphs. These include knowledge about datacenter and network infrastructure, deployable applications and their observable metrics, and geographical polygons that define valid 5G slice areas.