# Intent Simulator

A simulator for generating [TM Forum formatted](https://www.tmforum.org/intent) intents for the [5G4DATA use case](http://start5g-1.cs.uit.no:5003). This tool allows you to generate and store network configuration and workload deployment intents in GraphDB.

## Features

- Generate network slice configuration intents with QoS guarantees
- Generate workload deployment intents for cloud-native applications
- Configure intent generation parameters through a modern web interface
- Generate single intents or sequences with configurable timing
- Store generated intents in GraphDB

## Setup

1. Create and activate a Python virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment variables:
Create a `.env` file in the root directory with these variables and set them according to your environment:
```
FLASK_APP=backend/app.py
FLASK_ENV=development
GRAPHDB_URL=http://localhost:7200
# ChatGPT is used to generate region polygons based on geographical names.
OPENAI_API_KEY=sk-proj-xxxxxxxxx
```

## Running the Application

1. Start the backend server:
```bash
export PYTHONPATH=$PYTHONPATH:.
flask run # optional add port like this --port 3004
```

2. Open your browser and navigate to `http://localhost:3000` (or other port number, if you changed it)

## Usage

1. Configure the simulator parameters in the web interface
2. Choose between generating a single intent or a sequence
3. For sequences, configure the time interval between intents
4. Click "Generate" to create and store the intents

## Intent Templates

The simulator supports three types of intents:

1. Network Configuration Intents:
   - Configure network slices with QoS guarantees
   - Set latency, bandwidth, and geographical area requirements

2. Workload Deployment Intents:
   - Deploy cloud-native applications
   - Configure compute requirements and deployment locations 

3. Combined Network and Workload Intents:
   - Simultaneously configure network slices and deploy applications
   - Integrate both network QoS and compute requirements in a single intent 