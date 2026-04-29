# Sustainability

We want to integrate inSustain into the 5G4Data use-case. How do we do that? inSustain needs to be able to observe sustainability related metrics collected by Kepler, and needs to be triggered to start observing. To achieve that, the intents needs to express that sustainability metrics should be reported on. In the TM Forum intent ontology, if you want reports on something, there needs to be an associated Expectation. The Expectation can contain Conditions and the Conditions can describe detailed metrics and quantifiers describing when the Conditions are met. Without this structure, there is no way reports can be generated. We therefore need to add SustainabilityExpactations with Conditions that describes metrics with quantifiers defining when the Conditions are met.

**Note that some parts of the following discussion is related to how this would be handled in a real deployment and some parts are only related to how to do it for the agent based data generation simulator.**

## Add SustainabilityExpectation to user intents or in additional intents

IDO/inOrch is all about orchestration to make sure that the intent objectives are fulfilled. inSustain is all about monitoring to see if the sustainability objectives are fulfilled and potentially initiating actions to improve the sustainability of the intent. Since this is similar, we could reuse the IDO/inOrch pattern on how this is handled.

In an intent driven system, everything that you want to happen needs to be modelled as an intent. This means that we need to add a SustainabilityExpectation to the user intents or in additional intents if we want reports on metrics related to sustainability to occur.

IDO/inOrch and inSustain have in common that they are related to workloads deployed in Kubernetes cluster in 5G4Data Edge Clusters. This means that we can use the same pattern used for DeploymentExpectations to add SustainabilityExpectations to intents.

```
data5g:SEb0aab5e8633046aa9634dc1594671850 a data5g:SustainabilityExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "Sustainability expectations for the rusty-llm workload" ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COd1dfd984940a452d89af523502baf9ee,
        data5g:CX2f4d6697a0dd4630aaf1327741f6c55b .
    # The conditions will express the exact metrics to be monitored
```
The current OpenClawPackages/5g4data-intent-generation packages includes a tool that will use the Workload catalogue API to find workloads that matches the natural language representation of the intent. The helm chart for the matching workload is opened and the values.yaml file is extracted. The ***intent/objectives*** part of the values.yaml file is used to add Conditions for metrics that the deployment of the workload is supposed to meet. This IDO/inOrch pattern can be used for SustainabilityExpectations as well.

## Add sustainability objectives to the workload Helm chart

We can also use the IDO/inOrch pattern to add sustainability objectives (conditions) to intents. In the IDO/inOrch pattern, objectives that the IDO/inOrch should handle are expressed in the values.yaml file in the Helm chart for the workload. We could also add sustainability objectives to the values.yaml file of the workload. The sustainability objectives can match metrics that Kepler can collect from the workload when it is deployed in a Kubernetes cluster (e.g. container metrics like kepler_container_cpu_joules_total and kepler_container_cpu_watts). If the value that should be met is undefined, we could use the tmf-value-hint to set a default value that is large. Example entries in values.yaml:
```
intent:
  enabled: true  # Set to true to enable Intent resource
  name: "llm-intent"  # Name of the Intent resource
  priority: 1.0
  targetRef:
    name: ""  # Leave empty to auto-generate from deployment
  objectives:
    - name: p99-token-target
      value: 0.0  # Set to null so that TMF-proxy can set it during deployment based on value in TMF intent
      tmf-value-hint: 400.0
      measuredBy: intend/p99token
  sustainability:
    - name: kepler_container_cpu_joules_total
      value: 0.0
      tmf-value-hint: 10000
      measuredBy: intend/cpu_joules_total
    - name: kepler_container_cpu_watts
      value: 0.0
      tmf-value-hint: 10000
      measuredBy: intend/container_cpu_watts
```
ObservationReports can be generated even if the objective is met. This can be achieved using the time based reporting mechanism that is now added in v3.8.0 of the Intent Common Model specification.

## ObservationReportingExpectation

When a SustainabilityExpectation is added to an intent it is also possible to add an ObservationReportingExpectation that ensures that the sustainability objectives are monitored and reported on. This again follows the pattern that IDO/inOrch uses for the ObservationReportingExpectation that is added to intents for DeploymentExpectations.
```
data5g:tenMinutes a t:DurationDescription ;
    t:numericDuration "10"^^xsd:decimal ;
    t:unitType t:unitMinute .

data5g:TenMinuteReportEvent a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:tenMinutes ) ;
    # Can eventFor be an Expectation?
    imo:eventFor data5g:SEb0aab5e8633046aa9634dc1594671850 .

data5g:ORE359d9ce864cd48a2a63dbeb3d4e33896 a icm:ObservationReportingExpectation ;
    dct:description "Metric observation reports every 10 minutes." ;
    icm:target data5g:deployment ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEvent ] .
```
How to make sure that the reporting on sustainability metrics goes to Prometheus? The reporting icm:reportDestinations could probably be used for this, e.g. this line:

**`icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] ;`**

Should we, for simplicity, have one single prometheus instance as we currently do have for GraphDB based reporting? At least for the data generation simulator this should be OK?

## Triggering inSustain

Since there now exists a SustainabilityExpectation in the intent, we could, as for DeploymentExpectation and NetworkExpectations let inServ dispatch intents with the SustainabilityExpectation directly to inSustain, thus serving as the trigger. IDO/inOrch will also have to get it since IDO/inOrch needs to be aware that the reporting for the sustainability should be done. This means that IDO/inOrch is the handler for the SustainabilityExpectation related to the reporting, and inSustain just uses the incoming intent with the SustainabilityExpectation as a trigger to start observing the related metrics.