# inOrch workflow
In the MVS, inOrch will receive properly formed rsource level TM Forum formatted intents that follows the 5G4DATA use case template for deployment intents from inSwitch. inSwitch is therefore (in TM Forum terminology) the intent owner, and inNet is the intent handler of such Intents. How inOrch tries to fulfill the intent is up to inOrch to decide. Since the Intent includes the edge data center the workload should be deployed to, the workload identifier and a link to the deployment descriptor✳️ the job should (for the MVS) be relatively straight forward.

 Later on in the project we will hopefully provide live (lab) infrastructure that can be used. We are currently restructuring our iCora (and renamed it to Telenor Open Lab) and the details of what it will support is yet to be decided.

> **✳️**  
> It is still TBD if the deployment descriptor will be a Manifest, a Helm chart or a Kustomization description.