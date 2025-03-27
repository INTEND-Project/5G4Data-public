# inChat workflow
The inChat tool will have a conversation with a Telenor customer that expresses business level intents in natural language. Examples of intents that may be handled in the context of the 5G4DATA use case are:
|<div style="width:25px">Id</div>|<div style="width:200px">Objective</div>|<div style="width:300px">Description</div>|
|------|---------------|-------|
| 1	| Optimize performance of a running application	| My retail store AR application is not giving my customers a good experience. It seems to be lagging, possibly due to high latency or poor bandwidth. Please fix it. The AR goggles are connected to Telenor 5G network in my store in Tromsø, Norway. My store is located in the K1 shopping mall.|
| 2 | Temporarily reconfigure the infrastructure for special needs | I am going to host a gaming event in Oslo at Fornebu Expo Hotel on Saturday and Sunday next week, using an online game called X currently hosted by H. Our game consoles will connect using a 5G network provided by T. Make sure that we get a setup that allows all gamers a good experience. We expect 150 people registered. |
| 3	| Guarantee performance (QoS and QoE) during the runtime of an application | I am going to fly my drone for a rescue mission in Tromsdalen, Norway and I need to be sure that 4K video is sent to an object detection classifications model to detect people and their winter equipment like skis, etc. using the ObjectDetectionModel is sent to my graphical user interface in real-time without loss. |
| 4 | Do classification of customer calls (reason to call) in near real time | I want to classify customer calls with respect to why the call was made. The classification should support the human call handler in finding a solution for the customer. My call centre is in Bodø. I want to have as low cost as possible for the solution and would like to keep the data close for privacy reasons.|

Based on the description from the Telenor customer, inChat should form a business level intent. We have not yet designed what such an intent should look like, but it should be expressed according to TM Forum intent ontology. In its simplest form it could just be something like this:
```
@prefix # Add needed namespace prefixes
# In this example, the natural language intent is in a slightly transformed form
# just expressed in a dct:description field. 
5g4data:I1 a icm:Intent ;
        dct:description "Ensure low latency and sufficient bandwidth in 
        the 5G network for customer +47 90914547 AR application in customer
        store at K1 shopping center in Tromsø, Norway."@en ;
.
```
When the Intent is formed, the TM Forum Intent management API is used to send the Intent to inSwitch.