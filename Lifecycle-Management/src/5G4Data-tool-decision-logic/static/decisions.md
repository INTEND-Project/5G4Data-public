# Decisions to be made by the tools for the 5G4Data use case
## Sample intents
|<div style="width:25px">Id</div>|<div style="width:200px">Objective</div>|<div style="width:300px">Description</div>|
|------|---------------|-------|
| 1	| Optimize performance of a running application	| My retail store AR application is not giving my customers a good experience. It seems to be lagging, possibly due to high latency or poor bandwidth. Please fix it. The AR goggles are connected to Telenor 5G network in my store in Tromsø, Norway. My store is located in the K1 shopping mall.|
| 2 | Temporarily reconfigure the infrastructure for special needs | I am going to host a gaming event in Oslo at Fornebu Expo Hotel on Saturday and Sunday next week, using an online game called X currently hosted by H. Our game consoles will connect using a 5G network provided by T. Make sure that we get a setup that allows all gamers a good experience. We expect 150 people registered. |
| 3	| Guarantee performance (QoS and QoE) during the runtime of an application | I am going to fly my drone for a rescue mission in Tromsdalen, Norway and I need to be sure that 4K video is sent to an object detection classifications model to detect people and their winter equipment like skis, etc. using the ObjectDetectionModel is sent to my graphical user interface in real-time without loss. |
| 4 | Do classification of customer calls (reason to call) in near real time | I want to classify customer calls with respect to why the call was made. The classification should support the human call handler in finding a solution for the customer. My call centre is in Bodø. I want to have as low cost as possible for the solution and would like to keep the data close for privacy reasons.|

**Table 1:** List of sample intents for the 5G4Data MVS

## Sample intent #1
Fixing problems in an AR application would typically include doing a detailed analysis of the possible causes for lagging (high latency, low bandwidth, high error rate, and more) step by step and deciding on the best network configurations and workload deployment strategies implying a multitude of resource operations/actions. 
In the 5G4Data Minimal Viable Scenario (MVS) we will simplify the awareness, analysis, decision and execution procedures (see AN reference architecture figure below) focusing on three possible actions to fulfil an AR application requirement for latency, namely: 
1. network configuration (slice set up); 
2. workload placement (AR application run in cloud or edge datacentre(s)), or; 
3. both network configuration and workload placement.

In TM Forum terminology actions 1) and 2) involve one autonomous domain for each action, whereas action 3) involves two domains. The translation of sample intent #1 could happen at a service level or at a resource level. In the latter case, the INTEND tool which primarily governs the network configuration domain experience that actions in that domain is not enough for fulfilment of the original intent and therefore need to involve the workload placement domain.
Network latency is the total time it takes for data to travel from the user equipment (UE) to the server hosting the application and back. The key components that contribute to total network latency are:
1. User Equipment (UE) to Base Station (gNodeB)
    - Transmission Delay: Time taken to send data from the UE to the base station over the air interface using radio frequency signals
    - Propagation Delay: Time taken for the signal to travel from the UE to the base station, depending on the distance and speed of light in the propagation medium
    - Processing Delay: Time taken for the base station to process the received data, including decoding and error correction
2. Base Station (gNodeB) to Transport Network Breakout Point (5G SA UPF)
    - Backhaul Network Delay: Time taken for data to travel from the base station to the transport network breakout point. This includes any intermediate nodes and the quality of the backhaul network
    - Queueing Delay: Time data packets spend in queues waiting to be processed or transmitted at various network nodes
3. Transport Network Breakout Point to Server Hosting the Application
    - Internet Latency: Time taken for data to travel through the internet from the breakout point to the server. This includes:
        - Physical Distance: Longer distances increase latency
        - Network Congestion: High traffic can slow down data transmission
        - Router and Switch Delays: Time taken for data to pass through routers and switches along the path
4. Server compute time
    - Server Processing Speed: Time taken by the server to process the request and send a response. Defined by complexity of application and compute capacity.
5. Return Path
    - The same components contribute to latency on the return path from the server back to the UE.
