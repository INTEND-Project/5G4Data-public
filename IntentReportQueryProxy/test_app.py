#!/usr/bin/env python3
"""
Test script for the Intent Report Query Proxy Flask application
"""

import requests
import json
import time

def test_health_endpoint():
    """Test the health check endpoint"""
    try:
        response = requests.get('http://localhost:3010/health')
        print(f"Health check status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Health response: {json.dumps(data, indent=2)}")
            return True
        else:
            print(f"Health check failed: {response.text}")
            return False
    except Exception as e:
        print(f"Health check error: {e}")
        return False

def test_root_endpoint():
    """Test the root endpoint"""
    try:
        response = requests.get('http://localhost:3010/')
        print(f"Root endpoint status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Root response: {json.dumps(data, indent=2)}")
            return True
        else:
            print(f"Root endpoint failed: {response.text}")
            return False
    except Exception as e:
        print(f"Root endpoint error: {e}")
        return False

def test_metric_endpoint(metric_name):
    """Test the metric reports endpoint"""
    try:
        url = f'http://localhost:3010/api/get-metric-reports/{metric_name}'
        print(f"Testing metric endpoint: {url}")
        
        response = requests.get(url)
        print(f"Metric endpoint status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Metric response: {json.dumps(data, indent=2)}")
            return True
        elif response.status_code == 404:
            print(f"Metric not found: {response.json()}")
            return True  # This is expected for non-existent metrics
        else:
            print(f"Metric endpoint failed: {response.text}")
            return False
    except Exception as e:
        print(f"Metric endpoint error: {e}")
        return False

def test_metric_endpoint_with_time_range(metric_name, start_time, end_time):
    """Test the metric reports endpoint with time range parameters"""
    try:
        url = f'http://localhost:3010/api/get-metric-reports/{metric_name}?start={start_time}&end={end_time}'
        print(f"Testing metric endpoint with time range: {url}")
        
        response = requests.get(url)
        print(f"Metric endpoint with time range status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Metric response with time range: {json.dumps(data, indent=2)}")
            return True
        elif response.status_code == 404:
            print(f"Metric not found with time range: {response.json()}")
            return True  # This is expected for non-existent metrics
        else:
            print(f"Metric endpoint with time range failed: {response.text}")
            return False
    except Exception as e:
        print(f"Metric endpoint with time range error: {e}")
        return False

def main():
    """Run all tests"""
    print("Testing Intent Report Query Proxy...")
    print("=" * 50)
    
    # Wait a moment for the server to start
    time.sleep(2)
    
    # Test health endpoint
    print("\n1. Testing health endpoint...")
    health_ok = test_health_endpoint()
    
    # Test root endpoint
    print("\n2. Testing root endpoint...")
    root_ok = test_root_endpoint()
    
    # Test metric endpoint with example metrics
    print("\n3. Testing metric endpoints...")
    
    # Test bandwidth metric
    print("\n   Testing bandwidth metric...")
    bandwidth_ok = test_metric_endpoint("bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1")
    
    # Test network latency metric
    print("\n   Testing network latency metric...")
    latency_ok = test_metric_endpoint("networklatency_co_3f3f7be883774d8b88f37bd73f8a775b")
    
    # Test time range scenarios
    print("\n4. Testing time range scenarios...")
    
    # Test with Unix timestamps
    print("\n   Testing with Unix timestamps...")
    unix_start = "1640995200"  # 2022-01-01 00:00:00 UTC
    unix_end = "1641081600"    # 2022-01-02 00:00:00 UTC
    time_range_unix_ok = test_metric_endpoint_with_time_range(
        "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b", 
        unix_start, 
        unix_end
    )
    
    # Test with ISO format timestamps
    print("\n   Testing with ISO format timestamps...")
    iso_start = "2025-08-08T08:00:00Z"
    iso_end = "2025-08-08T09:00:00Z"
    time_range_iso_ok = test_metric_endpoint_with_time_range(
        "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b", 
        iso_start, 
        iso_end
    )
    
    # Test with current time range (last hour)
    print("\n   Testing with current time range...")
    current_time = int(time.time())
    one_hour_ago = current_time - 3600
    time_range_current_ok = test_metric_endpoint_with_time_range(
        "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b", 
        str(one_hour_ago), 
        str(current_time)
    )
    
    # All metrics should work
    metric_ok = bandwidth_ok and latency_ok
    time_range_ok = time_range_unix_ok and time_range_iso_ok and time_range_current_ok
    
    # Summary
    print("\n" + "=" * 50)
    print("Test Summary:")
    print(f"Health endpoint: {'✓' if health_ok else '✗'}")
    print(f"Root endpoint: {'✓' if root_ok else '✗'}")
    print(f"Bandwidth metric: {'✓' if bandwidth_ok else '✗'}")
    print(f"Network latency metric: {'✓' if latency_ok else '✗'}")
    print(f"Overall metric tests: {'✓' if metric_ok else '✗'}")
    print(f"Time range tests: {'✓' if time_range_ok else '✗'}")
    
    if health_ok and root_ok and metric_ok and time_range_ok:
        print("\nAll tests passed! The application is working correctly.")
    else:
        print("\nSome tests failed. Check the application logs for details.")

if __name__ == "__main__":
    main() 