#!/usr/bin/env python3
"""
Simple test to isolate bandwidth metric issue
"""

import requests
import time

def simple_test():
    """Simple test to check bandwidth metric"""
    
    base_url = "http://start5g-1.cs.uit.no:3010"
    
    print("Simple bandwidth metric test:")
    print("=" * 40)
    
    # Test 1: Basic bandwidth metric without time range
    print("\n1. Testing bandwidth metric without time range:")
    try:
        url = f"{base_url}/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1"
        response = requests.get(url)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ Success")
            print(f"   Data points: {len(data.get('data', []))}")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    # Test 2: Bandwidth metric with time range
    print("\n2. Testing bandwidth metric with time range:")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f"{base_url}/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start={one_hour_ago}&end={current_time}"
        response = requests.get(url)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ Success")
            print(f"   Data points: {len(data.get('data', []))}")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    # Test 3: Bandwidth metric with step parameter
    print("\n3. Testing bandwidth metric with step parameter:")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f"{base_url}/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start={one_hour_ago}&end={current_time}&step=60s"
        response = requests.get(url)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   ✓ Success")
            print(f"   Data points: {len(data.get('data', []))}")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")

if __name__ == "__main__":
    simple_test() 