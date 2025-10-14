#!/usr/bin/env python3
"""
Example Python script to generate intents using the Intent Simulator API
"""

import requests
import json
import time

class IntentSimulatorClient:
    def __init__(self, base_url="http://localhost:5000"):
        self.base_url = base_url
    
    def generate_intent(self, intent_type, parameters, count=1, interval=0):
        """
        Generate one or more intents
        
        Args:
            intent_type (str): "network", "workload", or "combined"
            parameters (dict): Intent parameters
            count (int): Number of intents to generate (default: 1)
            interval (float): Time interval between intents in seconds (default: 0)
        
        Returns:
            dict: Response from the API
        """
        url = f"{self.base_url}/api/generate-intent"
        data = {
            "intent_type": intent_type,
            "parameters": parameters,
            "count": count,
            "interval": interval
        }
        
        response = requests.post(url, json=data)
        response.raise_for_status()
        return response.json()
    
    def get_intent(self, intent_id):
        """Retrieve a specific intent by ID"""
        url = f"{self.base_url}/api/get-intent/{intent_id}"
        response = requests.get(url)
        response.raise_for_status()
        return response.json()
    
    def query_intents(self):
        """Get all stored intents"""
        url = f"{self.base_url}/api/query-intents"
        response = requests.get(url)
        response.raise_for_status()
        return response.json()
    
    def delete_intent(self, intent_id):
        """Delete a specific intent"""
        url = f"{self.base_url}/api/delete-intent/{intent_id}"
        response = requests.delete(url)
        response.raise_for_status()
        return response.json()
    
    def delete_all_intents(self):
        """Delete all intents"""
        url = f"{self.base_url}/api/delete-all-intents"
        response = requests.post(url)
        response.raise_for_status()
        return response.json()


def main():
    # Initialize the client
    client = IntentSimulatorClient("http://localhost:5000")
    
    print("=== Intent Simulator API Client Example ===\n")
    
    # Example 1: Generate a network intent
    print("1. Generating a network intent...")
    network_params = {
        "description": "High-performance network slice for gaming",
        "latency": 10,
        "latency_operator": "smaller",
        "bandwidth": 1000,
        "bandwidth_operator": "larger",
        "location": "Oslo, Norway",
        "customer": "+47 12345678",
        "handler": "network-handler-1",
        "owner": "gaming-service-provider"
    }
    
    try:
        result = client.generate_intent("network", network_params)
        print(f"✅ Network intent generated: {result['message']}")
        network_intent_id = result['intent_ids'][0]
        print(f"   Intent ID: {network_intent_id}")
    except Exception as e:
        print(f"❌ Error generating network intent: {e}")
        return
    
    # Example 2: Generate a workload intent
    print("\n2. Generating a workload intent...")
    workload_params = {
        "description": "Deploy AR retail application to edge datacenter",
        "compute_latency": 5,
        "compute_latency_operator": "smaller",
        "datacenter": "EC2",
        "application": "ar-retail-v2",
        "descriptor": "http://intend.eu/5G4DataWorkloadCatalogue/ar-retail-deployment.yaml",
        "handler": "workload-handler-1",
        "owner": "retail-company"
    }
    
    try:
        result = client.generate_intent("workload", workload_params)
        print(f"✅ Workload intent generated: {result['message']}")
        workload_intent_id = result['intent_ids'][0]
        print(f"   Intent ID: {workload_intent_id}")
    except Exception as e:
        print(f"❌ Error generating workload intent: {e}")
        return
    
    # Example 3: Generate a combined intent
    print("\n3. Generating a combined intent...")
    combined_params = {
        "description": "Combined network and workload deployment for IoT sensors",
        "latency": 15,
        "latency_operator": "smaller",
        "bandwidth": 500,
        "bandwidth_operator": "larger",
        "compute_latency": 8,
        "compute_latency_operator": "smaller",
        "location": "Bergen, Norway",
        "customer": "+47 87654321",
        "datacenter": "EC3",
        "application": "iot-sensor-manager",
        "handler": "combined-handler-1",
        "owner": "iot-service-provider"
    }
    
    try:
        result = client.generate_intent("combined", combined_params)
        print(f"✅ Combined intent generated: {result['message']}")
        combined_intent_id = result['intent_ids'][0]
        print(f"   Intent ID: {combined_intent_id}")
    except Exception as e:
        print(f"❌ Error generating combined intent: {e}")
        return
    
    # Example 4: Generate multiple intents with interval
    print("\n4. Generating multiple network intents with interval...")
    batch_params = {
        "description": "Batch network slice generation",
        "latency": 20,
        "bandwidth": 300,
        "location": "Trondheim, Norway"
    }
    
    try:
        result = client.generate_intent("network", batch_params, count=3, interval=1.0)
        print(f"✅ Batch generation completed: {result['message']}")
        batch_intent_ids = result['intent_ids']
        print(f"   Generated {len(batch_intent_ids)} intents")
    except Exception as e:
        print(f"❌ Error generating batch intents: {e}")
    
    # Example 5: Query all intents
    print("\n5. Querying all stored intents...")
    try:
        intents = client.query_intents()
        print(f"✅ Found {len(intents['intents'])} stored intents:")
        for intent in intents['intents']:
            print(f"   - ID: {intent['id']}, Type: {intent['type']}")
    except Exception as e:
        print(f"❌ Error querying intents: {e}")
    
    # Example 6: Retrieve a specific intent
    print(f"\n6. Retrieving network intent {network_intent_id}...")
    try:
        intent_data = client.get_intent(network_intent_id)
        print(f"✅ Retrieved intent data (first 200 chars):")
        print(f"   {intent_data['data'][:200]}...")
    except Exception as e:
        print(f"❌ Error retrieving intent: {e}")
    
    print("\n=== Example completed ===")
    print("Note: To clean up, you can call client.delete_all_intents()")


if __name__ == "__main__":
    main()
