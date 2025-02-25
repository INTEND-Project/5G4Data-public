# Synthetic latency measurements
This folder contains python source code for programs that generate synthetic data for latency, between EDGE data center locations in the Nordics, for the INTEND 5G4DATA use-case provided by Telenor.

## How is it generated?
The latency data is generated using a formula. First, the "line of sight" distance in km is caclulated, the distance is then increased by 50% to simulate that fiber optic cables are usually laid down close to existing infrastructures (e.g. road infrastructure). Then one way latency is calculated by multiplying the distance in km with 0.006 milliseconds (which is an estimated latency in fiber optic cables per km). The calculated latency is then increased by 30% to simulate time spent in network elements (e.g. routers, firewalls, gateways, repeaters, etc.). This latency is then multiplied by two for a round trip latency.

This is done between all edge datacenters and the result is a matrix with latency measurements between all edge datacenters. It requires that the lat/long coordinates of the edge data centers can be found in a file called cities_lat_lon.csv in the *../../tmp/cities_lat_lon.csv file*.

The coordinates found in this file can be plotted in a map and stored in a pdf file using the *pdf-draw-nordic-map-of-edge-clusters.py* python program. The pdf file generated will be stored in the ../../generated-syntetic-data folder.

## Does this reflect the end-to-end latency in a real network?
It is a qualified guess and is not 100% accurate, but for our usage it should be fine. 
```
Note that: In addition to the calculated latencies there will also be additional latencies resulting from radiowave transmission from user equipment (UE) to 5G basestations, time spent converting the analogue radio signals into digital data in basestation broadband units (BBU) and transmission to closest edge datacenter (usually over optical fiber). The latencies in the calculated matrix does therefore not represent the end-to-end latency between UE and compute workload.
```