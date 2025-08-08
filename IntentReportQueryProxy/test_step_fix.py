#!/usr/bin/env python3
"""
Quick test script to verify step parameter fix
"""

import requests
import time

def test_step_parameter_fix():
    base_url = "http://localhost:3010"
    bandwidth_metric = "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1"
    
    print("Testing step parameter fix...")
    
    # Test 1: No step parameter (should use default 60s)
    print("\n1. Testing without step parameter:")
    current_time = int(time.time())
    one_hour_ago = current_time - 3600
    url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}'
    
    try:
        response = requests.get(url)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', None)
            print(f"   Step value: {step_value}")
            print("   ✓ Success - no step parameter")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    # Test 2: Empty step parameter (should use default 60s)
    print("\n2. Testing with empty step parameter:")
    url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}&step='
    
    try:
        response = requests.get(url)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', None)
            print(f"   Step value: {step_value}")
            print("   ✓ Success - empty step parameter")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    # Test 3: Custom step parameter
    print("\n3. Testing with custom step parameter:")
    url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}&step=30s'
    
    try:
        response = requests.get(url)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', None)
            print(f"   Step value: {step_value}")
            print("   ✓ Success - custom step parameter")
        else:
            print(f"   ✗ Failed: {response.text}")
    except Exception as e:
        print(f"   ✗ Error: {e}")

if __name__ == "__main__":
    test_step_parameter_fix() 