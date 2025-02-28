# 5G4DATA use-case synthetic data
This folder contains several files that describes the 5G4DATA use-case infrastructure. Note that for the open loop Minimal Viable Scenario (MVS) this is regarded as static data, but for the closed loop MVS, this should be regarded as dynamically changing data.

These files have been generated based on the infrastructure description found in the ../infrastructure-data folder and represents plasible synthetic data for the infrastructure. The reason for using synthetic data is twofolded, partly because the complete infrastructure is not live (completed) yet and partly because this type of infrastructure is regarded as sociatal critical and under strict regulations.

| File name                  | Description                           |
| -------------------------- | ------------------------------------- |
| Nordic_Distances_Matrix.csv | Distances in **km** between all the Edge Data centers. This file is used to generate the other metrics and is regarded as temporary and not part of the infrastructure description. |
| Nordic_Latencies_Matrix.csv | Round-trip latencies in **ms** between all the Edge Data centers. The measurements represents the latency in the transport network (fiber optic cables). |
| Nordic_Bandwidth_Matrix.csv | Bandwith in **Tbit/s** between all the Edge Data centers. The measurements represents the bandwidth in the transport network (fiber optic cables). |
| Nordic_Packet_Error_Rate_Matrix.csv | Packet error rate (PER) in **packets/s** between all the Edge Data centers. The measurements represents the PER in the transport network (fiber optic cables).|
| Nordic_Cities_Mercator.pdf | This is just a plot of the geographical position of the Edge data centers. |


