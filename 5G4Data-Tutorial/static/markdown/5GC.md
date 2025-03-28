# 5GC
This represents the 5G Stand Alone (SA) Core network. The 5G SA Core network controls the 5G infrastructure. One of the 5G SA Core network functions is the Network Exposure Function (NEF). The NEF comes with an API. The NEF API allows outside entities to interact with the 5G network and will (in one way or another ✳️) be used by inNet to configure the 5G network in accordance with content of received Intents from inSwitch. Currently, the only Intent supported by the 5G4DATA MVS is Intents that configures 5G network slices with specific QoS parameters.

> **✳️**  
>Nokia Network as Code (NaC) the Camara API and the TM Forum Service API uses the NEF API to interact with a 5G SA Core network. inNet may use the NaC API or the Camara API to do its business, but these API's will use the NEF API.
