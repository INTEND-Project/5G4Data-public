# TODO

## How should the metric reporting be done?  
IDO Prometheus query for the p99-target is mirrored and reported on if there is a TMF intent ReportingExpectation for it.

## How do we query IDO to check the status of the intention 
So that the TMF-proxy can report back according to TMF intent management specification (Received, Compliant, Degraded etc).

Not stored in IDO, so: Create it when the metric report is sent (check the value and compare it to the condition in the intent)

## Should we try to train an algorithm to scale the cluster? 
Not for now, maybe some other partners are interested?

## Link to inSustain
Add Kepler to the clusters and let them extract metrics directly from Kepler/Prometheus.
