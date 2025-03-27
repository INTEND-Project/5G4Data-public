# inNet workflow
In the MVS, inNet will receive properly formed rsource level TM Forum formatted intents that follows the 5G4DATA use case template for network intents from inSwitch. inSwitch is therefore (in TM Forum terminology) the intent owner, and inNet is the intent handler. How inNet tries to fulfill the intent is up to inNet to decide. There are several ways this can be handled, and the way inNet does it must match the underlying infrastructure way of doing it. Some options are:
 - Use the NEF API
 - Use the Camara API
 - Use Nokia Network as Code (NaC)
 - Issue a service order

 Later on in the project we will hopefully provide live (lab) infrastructure that can be used. We are currently restructuring our iCora (and renamed it to Telenor Open Lab) and the details of what it will support is yet to be decided.