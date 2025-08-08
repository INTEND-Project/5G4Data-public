#!/usr/bin/env python3
"""
Test query detection logic
"""

def test_query_detection():
    """Test the Prometheus query detection logic"""
    
    # The actual query from the logs
    test_query = "http://start5g-1.cs.uit.no:9090/api/v1/query_range?query=bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1%7Bjob%3D%22intent_reports%22%7D"
    
    print("Testing query detection:")
    print("=" * 40)
    print(f"Query: {test_query}")
    print()
    
    # Apply the same detection logic
    is_prometheus_query = (':9090' in test_query or 'api/v1/query' in test_query or 'api/v1/query_range' in test_query)
    
    print(f"Contains ':9090': {':9090' in test_query}")
    print(f"Contains 'api/v1/query': {'api/v1/query' in test_query}")
    print(f"Contains 'api/v1/query_range': {'api/v1/query_range' in test_query}")
    print(f"Is Prometheus query: {is_prometheus_query}")
    
    if is_prometheus_query:
        print("✓ Should add step parameter")
    else:
        print("✗ Should NOT add step parameter")

if __name__ == "__main__":
    test_query_detection() 