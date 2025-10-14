#!/usr/bin/env python3
"""
Simple example of using the Intent Simulator API
"""

import requests
import json

# API endpoint
API_URL = "http://localhost:5000/api/generate-intent"

# Example: Generate a network intent
network_intent_data = {
    "intent_type": "network",
    "parameters": {
        "description": "High-speed network slice for video streaming",
        "latency": 5,
        "latency_operator": "smaller",
        "bandwidth": 2000,
        "bandwidth_operator": "larger",
        "location": "Oslo, Norway",
        "customer": "+47 12345678"
    },
    "count": 1,
    "interval": 0
}

# Send the request
try:
    response = requests.post(API_URL, json=network_intent_data)
    response.raise_for_status()
    
    result = response.json()
    print("✅ Intent generated successfully!")
    print(f"Message: {result['message']}")
    print(f"Intent ID: {result['intent_ids'][0]}")
    
except requests.exceptions.RequestException as e:
    print(f"❌ Error: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
