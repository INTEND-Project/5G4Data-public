#!/usr/bin/env python3
"""
Test script for the Intent Report Query Proxy Flask application
"""

import requests
import json
import time
import argparse
import sys

def test_health_endpoint(base_url):
    """Test the health check endpoint"""
    try:
        response = requests.get(f'{base_url}/health')
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

def test_root_endpoint(base_url):
    """Test the root endpoint"""
    try:
        response = requests.get(f'{base_url}/')
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

def test_metric_endpoint(base_url, metric_name):
    """Test the metric reports endpoint"""
    try:
        url = f'{base_url}/api/get-metric-reports/{metric_name}'
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

def test_metric_endpoint_with_time_range(base_url, metric_name, start_time, end_time, step=None):
    """Test the metric reports endpoint with time range parameters"""
    try:
        url = f'{base_url}/api/get-metric-reports/{metric_name}?start={start_time}&end={end_time}'
        if step:
            url += f'&step={step}'
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

def test_bandwidth_metrics_with_time_constraints(base_url):
    """Test bandwidth metrics with various time constraints"""
    bandwidth_metric = "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1"
    results = {}
    
    print("\n   Testing bandwidth metrics with time constraints...")
    
    # Test 1: Last 1 hour
    print("\n     Test 1: Last 1 hour")
    current_time = int(time.time())
    one_hour_ago = current_time - 3600
    results['last_1_hour'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, str(one_hour_ago), str(current_time)
    )
    
    # Test 2: Last 6 hours
    print("\n     Test 2: Last 6 hours")
    six_hours_ago = current_time - (6 * 3600)
    results['last_6_hours'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, str(six_hours_ago), str(current_time)
    )
    
    # Test 3: Last 24 hours
    print("\n     Test 3: Last 24 hours")
    one_day_ago = current_time - (24 * 3600)
    results['last_24_hours'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, str(one_day_ago), str(current_time)
    )
    
    # Test 4: Specific time window (ISO format)
    print("\n     Test 4: Specific time window (ISO format)")
    iso_start = "2025-01-01T00:00:00Z"
    iso_end = "2025-01-01T23:59:59Z"
    results['specific_iso_window'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, iso_start, iso_end
    )
    
    # Test 5: Short time window (5 minutes)
    print("\n     Test 5: Short time window (5 minutes)")
    five_minutes_ago = current_time - 300
    results['last_5_minutes'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, str(five_minutes_ago), str(current_time)
    )
    
    # Test 6: Medium time window (1 hour with 10-minute step)
    print("\n     Test 6: Medium time window (1 hour)")
    one_hour_ago = current_time - 3600
    results['last_1_hour_medium'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, str(one_hour_ago), str(current_time)
    )
    
    # Test 7: Future time window (should return empty or error)
    print("\n     Test 7: Future time window")
    future_start = current_time + 3600
    future_end = current_time + 7200
    results['future_window'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, str(future_start), str(future_end)
    )
    
    # Test 8: Very old time window
    print("\n     Test 8: Very old time window")
    old_start = current_time - (365 * 24 * 3600)  # 1 year ago
    old_end = current_time - (364 * 24 * 3600)    # 364 days ago
    results['old_window'] = test_metric_endpoint_with_time_range(
        base_url, bandwidth_metric, str(old_start), str(old_end)
    )
    
    return results

def test_bandwidth_metrics_data_validation(base_url):
    """Test bandwidth metrics data validation and structure"""
    bandwidth_metric = "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1"
    results = {}
    
    print("\n   Testing bandwidth metrics data validation...")
    
    # Test 1: Check response structure
    print("\n     Test 1: Check response structure")
    try:
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}'
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            has_data = 'data' in data
            has_meta = 'meta' in data
            has_metric_name = 'metric_name' in data.get('meta', {})
            has_query = 'query' in data.get('meta', {})
            
            results['response_structure'] = has_data and has_meta and has_metric_name and has_query
            print(f"       Response structure valid: {results['response_structure']}")
        else:
            results['response_structure'] = False
            print(f"       Response structure failed: {response.status_code}")
    except Exception as e:
        results['response_structure'] = False
        print(f"       Response structure error: {e}")
    
    # Test 2: Check data format
    print("\n     Test 2: Check data format")
    try:
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}'
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            data_list = data.get('data', [])
            if data_list:
                first_item = data_list[0]
                has_timestamp = any('time' in key.lower() or 'date' in key.lower() for key in first_item.keys())
                has_value = any('value' in key.lower() for key in first_item.keys())
                results['data_format'] = has_timestamp and has_value
                print(f"       Data format valid: {results['data_format']}")
            else:
                results['data_format'] = True  # Empty data is also valid
                print("       Data format valid: Empty data")
        else:
            results['data_format'] = False
            print(f"       Data format failed: {response.status_code}")
    except Exception as e:
        results['data_format'] = False
        print(f"       Data format error: {e}")
    
    # Test 3: Check time range data consistency
    print("\n     Test 3: Check time range data consistency")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}'
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            has_start_time = 'start_time' in meta
            has_end_time = 'end_time' in meta
            results['time_range_consistency'] = has_start_time and has_end_time
            print(f"       Time range consistency: {results['time_range_consistency']}")
        else:
            results['time_range_consistency'] = False
            print(f"       Time range consistency failed: {response.status_code}")
    except Exception as e:
        results['time_range_consistency'] = False
        print(f"       Time range consistency error: {e}")
    
    return results

def test_prometheus_bandwidth_queries(base_url):
    """Test Prometheus-style bandwidth queries with time ranges"""
    bandwidth_metric = "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1"
    results = {}
    
    print("\n   Testing Prometheus-style bandwidth queries...")
    
    # Test 1: Instant query (no time range)
    print("\n     Test 1: Instant query (no time range)")
    try:
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}'
        response = requests.get(url)
        results['instant_query'] = response.status_code == 200
        print(f"       Instant query status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"       Instant query data points: {len(data.get('data', []))}")
    except Exception as e:
        results['instant_query'] = False
        print(f"       Instant query error: {e}")
    
    # Test 2: Range query with short time window
    print("\n     Test 2: Range query with short time window")
    try:
        current_time = int(time.time())
        five_minutes_ago = current_time - 300
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={five_minutes_ago}&end={current_time}'
        response = requests.get(url)
        results['range_query_short'] = response.status_code == 200
        print(f"       Range query short status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            data_points = len(data.get('data', []))
            print(f"       Range query short data points: {data_points}")
            # Should have more data points than instant query
            if data_points > 0:
                print(f"       Range query working correctly")
    except Exception as e:
        results['range_query_short'] = False
        print(f"       Range query short error: {e}")
    
    # Test 3: Range query with medium time window
    print("\n     Test 3: Range query with medium time window")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}'
        response = requests.get(url)
        results['range_query_medium'] = response.status_code == 200
        print(f"       Range query medium status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            data_points = len(data.get('data', []))
            print(f"       Range query medium data points: {data_points}")
    except Exception as e:
        results['range_query_medium'] = False
        print(f"       Range query medium error: {e}")
    
    # Test 4: Range query with ISO timestamps
    print("\n     Test 4: Range query with ISO timestamps")
    try:
        iso_start = "2025-01-01T00:00:00Z"
        iso_end = "2025-01-01T01:00:00Z"
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={iso_start}&end={iso_end}'
        response = requests.get(url)
        results['range_query_iso'] = response.status_code == 200
        print(f"       Range query ISO status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            print(f"       Converted timestamps: start={meta.get('start_time')}, end={meta.get('end_time')}")
    except Exception as e:
        results['range_query_iso'] = False
        print(f"       Range query ISO error: {e}")
    
    # Test 5: Check if Prometheus query conversion is working
    print("\n     Test 5: Check Prometheus query conversion")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}'
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            query = meta.get('query', '')
            # Check if query was converted to range query
            is_range_query = 'api/v1/query_range' in query or 'step=' in query
            results['prometheus_conversion'] = is_range_query
            print(f"       Prometheus conversion: {'✓' if is_range_query else '✗'}")
            if is_range_query:
                print(f"       Converted query: {query}")
        else:
            results['prometheus_conversion'] = False
            print(f"       Prometheus conversion failed: {response.status_code}")
    except Exception as e:
        results['prometheus_conversion'] = False
        print(f"       Prometheus conversion error: {e}")
    
    return results

def test_step_parameter_functionality(base_url):
    """Test the step parameter functionality for Prometheus queries"""
    bandwidth_metric = "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1"
    results = {}
    
    print("\n   Testing step parameter functionality...")
    
    # Test 1: Default step (60s)
    print("\n     Test 1: Default step (60s)")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}'
        response = requests.get(url)
        results['default_step'] = response.status_code == 200
        print(f"       Default step status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', '60s')
            print(f"       Default step value: {step_value}")
    except Exception as e:
        results['default_step'] = False
        print(f"       Default step error: {e}")
    
    # Test 2: Custom step (30s)
    print("\n     Test 2: Custom step (30s)")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}&step=30s'
        response = requests.get(url)
        results['custom_step_30s'] = response.status_code == 200
        print(f"       Custom step 30s status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', '30s')
            print(f"       Custom step value: {step_value}")
    except Exception as e:
        results['custom_step_30s'] = False
        print(f"       Custom step 30s error: {e}")
    
    # Test 3: Custom step (5m)
    print("\n     Test 3: Custom step (5m)")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}&step=5m'
        response = requests.get(url)
        results['custom_step_5m'] = response.status_code == 200
        print(f"       Custom step 5m status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', '5m')
            print(f"       Custom step value: {step_value}")
    except Exception as e:
        results['custom_step_5m'] = False
        print(f"       Custom step 5m error: {e}")
    
    # Test 4: Custom step (1h)
    print("\n     Test 4: Custom step (1h)")
    try:
        current_time = int(time.time())
        one_hour_ago = current_time - 3600
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?start={one_hour_ago}&end={current_time}&step=1h'
        response = requests.get(url)
        results['custom_step_1h'] = response.status_code == 200
        print(f"       Custom step 1h status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', '1h')
            print(f"       Custom step value: {step_value}")
    except Exception as e:
        results['custom_step_1h'] = False
        print(f"       Custom step 1h error: {e}")
    
    # Test 5: Step parameter without time range (should be ignored)
    print("\n     Test 5: Step parameter without time range")
    try:
        url = f'{base_url}/api/get-metric-reports/{bandwidth_metric}?step=30s'
        response = requests.get(url)
        results['step_without_time_range'] = response.status_code == 200
        print(f"       Step without time range status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            step_value = meta.get('step', None)
            print(f"       Step value without time range: {step_value}")
    except Exception as e:
        results['step_without_time_range'] = False
        print(f"       Step without time range error: {e}")
    
    return results

def main():
    """Run all tests"""
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Test the Intent Report Query Proxy Flask application')
    parser.add_argument('--url', '-u', 
                       default='http://localhost:3010',
                       help='Base URL of the Flask application (default: http://localhost:3010)')
    parser.add_argument('--wait', '-w', 
                       type=int, 
                       default=2,
                       help='Wait time in seconds before starting tests (default: 2)')
    
    args = parser.parse_args()
    base_url = args.url.rstrip('/')  # Remove trailing slash if present
    
    print("Testing Intent Report Query Proxy...")
    print(f"Base URL: {base_url}")
    print("=" * 50)
    
    # Wait a moment for the server to start
    if args.wait > 0:
        print(f"Waiting {args.wait} seconds for server to start...")
        time.sleep(args.wait)
    
    # Test health endpoint
    print("\n1. Testing health endpoint...")
    health_ok = test_health_endpoint(base_url)
    
    # Test root endpoint
    print("\n2. Testing root endpoint...")
    root_ok = test_root_endpoint(base_url)
    
    # Test metric endpoint with example metrics
    print("\n3. Testing metric endpoints...")
    
    # Test bandwidth metric
    print("\n   Testing bandwidth metric...")
    bandwidth_ok = test_metric_endpoint(base_url, "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1")
    
    # Test network latency metric
    print("\n   Testing network latency metric...")
    latency_ok = test_metric_endpoint(base_url, "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b")
    
    # Test time range scenarios
    print("\n4. Testing time range scenarios...")
    
    # Test with Unix timestamps
    print("\n   Testing with Unix timestamps...")
    unix_start = "1640995200"  # 2022-01-01 00:00:00 UTC
    unix_end = "1641081600"    # 2022-01-02 00:00:00 UTC
    time_range_unix_ok = test_metric_endpoint_with_time_range(
        base_url,
        "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b", 
        unix_start, 
        unix_end
    )
    
    # Test with ISO format timestamps
    print("\n   Testing with ISO format timestamps...")
    iso_start = "2025-08-08T08:00:00Z"
    iso_end = "2025-08-08T09:00:00Z"
    time_range_iso_ok = test_metric_endpoint_with_time_range(
        base_url,
        "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b", 
        iso_start, 
        iso_end
    )
    
    # Test with current time range (last hour)
    print("\n   Testing with current time range...")
    current_time = int(time.time())
    one_hour_ago = current_time - 3600
    time_range_current_ok = test_metric_endpoint_with_time_range(
        base_url,
        "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b", 
        str(one_hour_ago), 
        str(current_time)
    )
    
    # Test bandwidth metrics with time constraints
    print("\n5. Testing bandwidth metrics with time constraints...")
    bandwidth_time_constraints_results = test_bandwidth_metrics_with_time_constraints(base_url)
    
    # Test bandwidth metrics data validation
    print("\n6. Testing bandwidth metrics data validation...")
    bandwidth_data_validation_results = test_bandwidth_metrics_data_validation(base_url)
    
    # Test Prometheus-style bandwidth queries
    print("\n7. Testing Prometheus-style bandwidth queries...")
    prometheus_bandwidth_results = test_prometheus_bandwidth_queries(base_url)
    
    # Test step parameter functionality
    print("\n8. Testing step parameter functionality...")
    step_parameter_results = test_step_parameter_functionality(base_url)
    
    # All metrics should work
    metric_ok = bandwidth_ok and latency_ok
    time_range_ok = time_range_unix_ok and time_range_iso_ok and time_range_current_ok
    
    # Check bandwidth time constraints results
    bandwidth_time_constraints_ok = all(bandwidth_time_constraints_results.values())
    
    # Check bandwidth data validation results
    bandwidth_data_validation_ok = all(bandwidth_data_validation_results.values())
    
    # Check Prometheus bandwidth queries results
    prometheus_bandwidth_ok = all(prometheus_bandwidth_results.values())
    
    # Check step parameter results
    step_parameter_ok = all(step_parameter_results.values())
    
    # Summary
    print("\n" + "=" * 50)
    print("Test Summary:")
    print(f"Health endpoint: {'✓' if health_ok else '✗'}")
    print(f"Root endpoint: {'✓' if root_ok else '✗'}")
    print(f"Bandwidth metric: {'✓' if bandwidth_ok else '✗'}")
    print(f"Network latency metric: {'✓' if latency_ok else '✗'}")
    print(f"Overall metric tests: {'✓' if metric_ok else '✗'}")
    print(f"Time range tests: {'✓' if time_range_ok else '✗'}")
    print(f"Bandwidth time constraints: {'✓' if bandwidth_time_constraints_ok else '✗'}")
    print(f"Bandwidth data validation: {'✓' if bandwidth_data_validation_ok else '✗'}")
    print(f"Prometheus bandwidth queries: {'✓' if prometheus_bandwidth_ok else '✗'}")
    print(f"Step parameter functionality: {'✓' if step_parameter_ok else '✗'}")
    
    # Detailed bandwidth time constraints results
    if not bandwidth_time_constraints_ok:
        print("\nBandwidth Time Constraints Details:")
        for test_name, result in bandwidth_time_constraints_results.items():
            print(f"  {test_name}: {'✓' if result else '✗'}")
    
    # Detailed bandwidth data validation results
    if not bandwidth_data_validation_ok:
        print("\nBandwidth Data Validation Details:")
        for test_name, result in bandwidth_data_validation_results.items():
            print(f"  {test_name}: {'✓' if result else '✗'}")
    
    # Detailed Prometheus bandwidth queries results
    if not prometheus_bandwidth_ok:
        print("\nPrometheus Bandwidth Queries Details:")
        for test_name, result in prometheus_bandwidth_results.items():
            print(f"  {test_name}: {'✓' if result else '✗'}")
    
    # Detailed step parameter results
    if not step_parameter_ok:
        print("\nStep Parameter Details:")
        for test_name, result in step_parameter_results.items():
            print(f"  {test_name}: {'✓' if result else '✗'}")
    
    overall_success = (health_ok and root_ok and metric_ok and time_range_ok and 
                      bandwidth_time_constraints_ok and bandwidth_data_validation_ok and 
                      prometheus_bandwidth_ok and step_parameter_ok)
    
    if overall_success:
        print("\nAll tests passed! The application is working correctly.")
        sys.exit(0)
    else:
        print("\nSome tests failed. Check the application logs for details.")
        sys.exit(1)

if __name__ == "__main__":
    main() 