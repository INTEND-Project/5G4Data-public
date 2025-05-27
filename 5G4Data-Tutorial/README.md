# 5G4Data use case tutorial
We have created a tutorial that explains some of the decisions that the [INTEND project](https://intendproject.eu/) tools need to make for the 5G4DATA use-case. 
![INTEND project 5G4Data Use-case tutorial](./5G4Data-Tutorial.png)
A running version of the tutorial can be viewed [here](https://start5g-1.cs.uit.no).

## Run with certificates over https
This is the production setup where we use certificats to serve the tutorial using gunicorn and Caddy as security proxy. Certificates can be generated using certbot:
```
# Requires that a proper DNS entry exists for the server
# and that port 80 is open so that certbot can upload a
# small server to answer the challenge.
# ⚠️ NOTE: Change the email and domain name to match your setup.

sudo certbot certonly --standalone --preferred-challenges http --agree-tos --no-eff-email --email arne.munch-ellingsen@telenor.com -d start5g-1.cs.uit.no
```
To start the tutorial together with the workload catalog (with its chartmuseum backend), do this:
```
docker compose up -d --build
```
The tutorial is now running using https://start5g-1.cs.uit.no (or under the changed domain name).

## Run locally
It is also possible to clone this repository and do this to start it on your local machine:
```
docker build -t 5g4data-tutorial .
docker run -p 5003:5003 --name 5g4data-tutorial -d 5g4data-tutorial
# Or with a bit more security: docker run --cap-drop ALL --security-opt no-new-privileges -p 5003:5003 --name 5g4data-tutorial -d 5g4data-tutorial
# If port 5003 is in use on your computer, change the first 5003 to an unused port (e.g. 5005:5003)
# If you add certificates and want to run on https (add paths to cert files in 5G4Data.py)
docker run -d -p 443:443 --name 5g4data-tutorial-https 5g4data-tutorial-https
```

The tutorial is now running, you can access it in your browser like this (http://localhost:5003). 

⚠️ Note that you need to change the port number to the port you are using if you changed it from the default port 5003

⚠️ Note that the tutorial will try to display the (Workload Catalog)[https://github.com/INTEND-Project/5G4Data-public/tree/main/Workload-Catalog]. If this service is not running, the view will be empty.

The latency estimator tool (which is part of the turorial) was developed based on the description below.

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

The pseudo code below outlines a step-by-step decision-making process to determine the best course of action to meet an AR application's latency requirements. By measuring current latency, estimating potential reductions, and evaluating the impact of each action, an informed decision on whether to configure a network slice, place the application in a local data center, or both, can be made. Note that for the MVS we will estimate, rather than measure the current latency based on common knowledge, network latency and server characteristic information provided in the 5G4Data synthetic data repository.
```python 
def get_latency(start, end):
    """
    Measure network latency between start and end points 
    or calculate latency estimation based on static values or synthetic data.
    """
    return latency  # Replace with actual measurement logic

def get_latency_compute(server):
    """
    Measure compute latency or estimate latency based on server capacity.
    """
    return latency  # Replace with actual measurement logic

def estimate_latency_reduction_slice():
    """
    Estimate potential latency reduction from network slicing.
    """
    return estimated_reduction  # Replace with actual estimation logic

def estimate_latency_reduction_local_dc():
    """
    Estimate potential latency reduction from placing application in a local data center.
    """
    return estimated_reduction  # Replace with actual estimation logic

def execute_action(action):
    """
    Perform the necessary steps to configure the network or relocate the application.
    """
    print(f"Executing: {action}")
    # Implement necessary configuration

def decide_and_act():
    """
    Main function to assess latency and take necessary actions.
    """
    # Define latency requirements for the AR application
    # Use common knowledge; alternatively, ask the customer
    REQUIRED_LATENCY = {"min": 20, "max": 45}  # in milliseconds

    # Measure current latency components
    # Assume that each of the 40 data centre locations are Breakout Points
    current_latency_ue_to_gNodeB = get_latency("UE", "gNodeB")
    current_latency_gNodeB_to_breakout = get_latency("gNodeB", "BreakoutPoint")
    current_latency_breakout_to_server = get_latency("BreakoutPoint", "Server")
    current_latency_server_compute = get_latency_compute("Server")

    # Calculate total latency
    current_latency_total = (
        current_latency_ue_to_gNodeB +
        current_latency_gNodeB_to_breakout +
        current_latency_breakout_to_server +
        current_latency_server_compute
    )

    # Decision-making process
    if current_latency_total <= REQUIRED_LATENCY["max"]:
        print("Current latency meets the requirement. No action needed.")
        return

    # Evaluate impact of network slice configuration
    potential_latency_reduction_slice = estimate_latency_reduction_slice()
    new_latency_with_slice = current_latency_total - potential_latency_reduction_slice

    # Evaluate impact of application placement in local data center
    potential_latency_reduction_local_dc = estimate_latency_reduction_local_dc()
    new_latency_with_local_dc = current_latency_total - potential_latency_reduction_local_dc

    # Evaluate impact of both actions combined
    new_latency_with_both = current_latency_total - (
        potential_latency_reduction_slice + potential_latency_reduction_local_dc
    )

    # Decision logic
    if new_latency_with_both <= REQUIRED_LATENCY["max"]:
        execute_action("Configure network slice and place application in local data center")
        print("Both actions executed to meet latency requirement.")

    elif new_latency_with_slice <= REQUIRED_LATENCY["max"]:
        execute_action("Configure network slice")
        print("Network slice configured to meet latency requirement.")

    elif new_latency_with_local_dc <= REQUIRED_LATENCY["max"]:
        execute_action("Place application in local data center")
        print("Application placed in local data center to meet latency requirement.")

    else:
        print("Neither action alone can meet the latency requirement. Consider both actions or further optimizations.")

# Run the main function
if __name__ == "__main__":
    decide_and_act()
```