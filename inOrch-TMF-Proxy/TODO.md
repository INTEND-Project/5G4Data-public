# TODO


## Done: Add the IDO intent to the helm chart
<span style="color: green;">
The workloads in the workload catalogue are the workloads that can be deployed to the edge data centers. Since each edge datacenter will have the IDO/Planner installed in the cluster, the IDO intent should be part of the helm chart. 

The inOrch-TMF-proxy will set the value(s) in the IDO intent based on values found in the TMF intent and update the IDO intent spec acordingly.
</span>

## How should the metric reporting be done?  
 - IDO Prometheus query for the p99-target is mirrored and reported on
 - Reports are only generated if there is a ReportingExpectation for it in the intent

## How do we query IDO to check the status of the intention 
So that the TMF-proxy can report back according to TMF intent management specification (Received, Compliant, Degraded etc).

Not stored in IDO, so: Create it when the metric report is sent (check the value and compare it to the condition in the intent)

## Should we try to train an algorithm to scale the cluster? 
Not for now, maybe some other partners are interested?

## Link to inSustain
Add Kepler to the clusters and let them extract metrics directly from Kepler/Prometheus.
