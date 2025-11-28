# TODO
## Handle sending the deployment intents to the right handler
Each edge datacenter will have its own instance of inOrch. The current implementation of inOrch-TMF-Proxy is probably an implementation of an inOrch TM Forum shim/proxy, since it handles deployment of workloads for one Edge datacenter instance and will "translate" the TM Forum intent into an IDO intent so that IDO+planner can handle it.

We need to introduce the functionality of parsing the initial intent from inChat and sending it to the right handler (i.e. the correct inOrch/Edge datacenter).

### How to do it?
 - Rename the current inOrch-TMF-Proxy to inOrch-TMF-Proxy. ✅
 - Create a new inOrch-TMF-Proxy that will parse the initial intent from inChat and send it to the right handler (i.e. the correct inOrch/Edge datacenter). In the case where the intent is a combined intent, it wil be split into one deployment intent and one network intent. The deployment intent is sent to the right deployment intent handler (the right inOrch-TMF-Proxy) and the network intent is sent to inNet.
 - Add to the intents a URL for the datacenter it is intended for (currently we only have the name in there), or add a lookup service that can be used to find the URL for the datacenter based on the name.






