#!/usr/bin/env python3
"""
Test Prometheus bandwidth query directly
"""

import requests
import time

def test_prometheus_direct():
    """Test the Prometheus bandwidth query directly"""
    
    # The bandwidth query from GraphDB
    base_query = "http://start5g-1.cs.uit.no:9090/api/v1/query_range?query=bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1%7Bjob%3D%22intent_reports%22%7D"
    
    print("Testing Prometheus bandwidth query directly:")
    print("=" * 50)
    print(f"Base query: {base_query}")
    print()
    
    # Test 1: Query without time range
    print("1. Testing query without time range:")
    try:
        response = requests.get(base_query)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ Success - got data")
            print(f"   Data keys: {list(data.keys())}")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    print()
    
    # Test 2: Query with time range but no step
    print("2. Testing query with time range but no step:")
    current_time = int(time.time())
    one_hour_ago = current_time - 3600
    query_with_time = f"{base_query}&start={one_hour_ago}&end={current_time}"
    
    try:
        response = requests.get(query_with_time)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ Success - got data")
            print(f"   Data keys: {list(data.keys())}")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    print()
    
    # Test 3: Query with time range and step
    print("3. Testing query with time range and step:")
    query_with_step = f"{base_query}&start={one_hour_ago}&end={current_time}&step=60s"
    
    try:
        response = requests.get(query_with_step)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ Success - got data")
            print(f"   Data keys: {list(data.keys())}")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")

if __name__ == "__main__":
    test_prometheus_direct() 