#!/usr/bin/env python3
"""
Test script to check bandwidth metric in GraphDB
"""

import requests
import json

def test_bandwidth_metric():
    """Test if bandwidth metric exists in GraphDB"""
    
    # GraphDB configuration
    GRAPHDB_URL = "http://start5g-1.cs.uit.no:7200"
    REPOSITORY = "intent-reports"
    
    # Test metrics
    test_metrics = [
        "bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1",
        "networklatency_co_3f3f7be883774d8b88f37bd73f8a775b"
    ]
    
    print("Testing metric queries in GraphDB:")
    print("=" * 50)
    
    for metric_name in test_metrics:
        print(f"\nTesting metric: {metric_name}")
        
        sparql_query = f"""
        PREFIX data5g: <http://5g4data.eu/5g4data#>

        SELECT ?object
        FROM NAMED <http://intent-reports-metadata>
        WHERE {{
          GRAPH <http://intent-reports-metadata> {{
            data5g:{metric_name} data5g:hasQuery ?object .
          }}
        }}
        """
        
        try:
            # Make request to GraphDB
            response = requests.post(
                f"{GRAPHDB_URL}/repositories/{REPOSITORY}",
                headers={
                    "Content-Type": "application/sparql-query",
                    "Accept": "application/sparql-results+json"
                },
                data=sparql_query
            )
            
            print(f"  Status: {response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                bindings = result.get('results', {}).get('bindings', [])
                
                if bindings:
                    query_value = bindings[0]['object']['value']
                    print(f"  ✓ Found query: {query_value}")
                    
                    # Check query type
                    if ':9090' in query_value:
                        print(f"  ✓ Prometheus query (port 9090)")
                    elif ':7200' in query_value:
                        print(f"  ✓ GraphDB query (port 7200)")
                    else:
                        print(f"  ? Unknown query type")
                else:
                    print(f"  ✗ No query found")
                    print(f"  Response: {result}")
            else:
                print(f"  ✗ GraphDB request failed")
                print(f"  Response: {response.text}")
                
        except Exception as e:
            print(f"  ✗ Error: {e}")

if __name__ == "__main__":
    test_bandwidth_metric() 