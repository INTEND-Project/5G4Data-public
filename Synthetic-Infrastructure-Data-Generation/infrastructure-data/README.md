# Edge data center infrastructure specifications
This folder contains a file (5G4Data_Nordic_Edge_Datacenters.csv) that describes the most important specifications for the 40 edge datacenters in Telenors infrastructure in the Nordics. The specifications for each data center are (example):

| Cluster_ID | City       | Latitude | Longitude | GPUs                                      | CPUs                            | Memory        | Access URL                                    | Major Source of Electricity | Cost of Compute |
|------------|-----------|----------|-----------|-------------------------------------------|---------------------------------|--------------|------------------------------------------------|-----------------------------|----------------|
| EC_1       | Copenhagen | 55.6761  | 12.5683   | 64 DGX H100 GPUs each with 8×80 GB of GPU memory | 128 × Intel Xeon Platinum 8480C | 128 TB DDR5 RAM | https://copenhagen.5g-edge-api.telenor.com | Wind Power | 10.4 |

The cost of compute is in USD for usage per hour of one of the eight GPUs in a DGX H100 GPU.

The file is in csv format. Some of the data centers are "hubs" and is larger than the other "spoke" data centers. The hubs are located in the cities:

Tromsø, Harstad, Bodø, Trondheim, Oslo, Bergen, Stavanger, Oulu, Helsinki, Stockholm, Malmö, Gothenburg, Luleå, Copenhagen, Odense

For these cities the number of GPU/CPU and memory will be larger than for the spokes.