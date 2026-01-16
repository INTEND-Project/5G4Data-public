# TODO

## Done: Add the IDO intent to the helm chart
<span style="color: green;">
The workloads in the workload catalogue are the workloads that can be deployed to the edge data centers. Since each edge datacenter will have the IDO/Planner installed in the cluster, the IDO intent should be part of the helm chart. 

The inOrch-TMF-proxy will set the value(s) in the IDO intent based on values found in the TMF intent and update the IDO intent spec acordingly.
</span>

## Done: How should the metric reporting be done?  
<span style="color: green;">

 - IDO Prometheus query for the p99-target is mirrored and reported on
 - Reports are only generated if there is a ReportingExpectation for it in the intent

 - The helm deployer is now starting reporting tasks and data seems to be correctly added to GraphDB.
 - The intent report simulator inserts a query for the metric in GraphDB (we added this to facilitate for retrieving data directly from Prometheus). The helm deployer does not, but probably should, and now it does.
  - The Grafana dashboard does not manage to get the metrics. Probably due to not being able to generate the metric name correctly (it looks like it is using p99_token_target instead of e.g. p99-token-target_COc3f4513c2c7e424a815c197cd50fdeeb). In other words, missing the condition identifier and using underscore instead of minus. Not sure how to fix this yet. Will have to look at how the main dashboard extracts the name and forwards it to the subdashboard (using url encoding). Fixed.
</span>

There is a problem with the coloring in Grafana dashboards, the area that is within the conditions fulfillment should be in green, not in read (also, the upper limit is not shown....)

## How do we query IDO to check the status of the intention 
So that the TMF-proxy can report back according to TMF intent management specification (Received, Compliant, Degraded etc).

Not stored in IDO, so, tentative solution: Create it when the metric report is sent (check the value and compare it to the condition in the intent)

This is a bit more complex than anticipated. The fullfillment could depend on more than one Expectation and more than one Condition in each Expectation. The TM Forum specifications allows for a multitude of relationships (allOf, oneOf, anyOf, etc.) both between Expectations and Conditions....


## Should we try to train an algorithm to scale the cluster? 
Not for now, maybe some other partners are interested?## Link to inSustain
Add Kepler to the clusters and let them extract metrics directly from Kepler/Prometheus.
