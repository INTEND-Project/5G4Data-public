#!/usr/bin/env python3
"""Test script to debug the intent-report-client package"""

import sys
import os
import json

# Import the package (should be installed or in the same directory)
from intent_report_client import IntentReportClient

def test_get_intents():
    """Test the get_intents() method"""
    print("=" * 60)
    print("Testing IntentReportClient.get_intents()")
    print("=" * 60)
    
    # Use the same configuration as the app
    graphdb_url = os.getenv('GRAPHDB_URL', 'http://start5g-1.cs.uit.no:7200')
    graphdb_repository = os.getenv('GRAPHDB_REPOSITORY', 'intents_and_intent_reports')
    
    print(f"\nGraphDB URL: {graphdb_url}")
    print(f"Repository: {graphdb_repository}")
    print()
    
    try:
        # Create client
        client = IntentReportClient(graphdb_url, repository=graphdb_repository)
        print(f"Client created successfully")
        print(f"Base URL: {client.base_url}")
        print(f"Repository: {client.repository}")
        print(f"Query endpoint: {client.query_endpoint}")
        print()
        
        # Test get_intents
        print("Calling get_intents()...")
        results = client.get_intents()
        
        print(f"\nResults type: {type(results)}")
        print(f"Results keys: {list(results.keys()) if isinstance(results, dict) else 'Not a dict'}")
        print()
        
        if isinstance(results, dict):
            if 'results' in results:
                bindings = results['results'].get('bindings', [])
                print(f"Number of bindings: {len(bindings)}")
                print()
                
                if bindings:
                    print("First binding:")
                    print(json.dumps(bindings[0], indent=2))
                    print()
                    
                    print("All intents:")
                    for i, binding in enumerate(bindings, 1):
                        intent_id = binding.get('id', {}).get('value', 'N/A')
                        intent_type = binding.get('type', {}).get('value', 'N/A')
                        print(f"  {i}. ID: {intent_id}, Type: {intent_type}")
                else:
                    print("No intents found in bindings")
            else:
                print("No 'results' key in response")
                print("Full response:")
                print(json.dumps(results, indent=2))
        else:
            print("Response is not a dictionary:")
            print(results)
            
    except Exception as e:
        print(f"\nERROR: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

def test_direct_query():
    """Test a direct SPARQL query to GraphDB"""
    print("\n" + "=" * 60)
    print("Testing direct SPARQL query")
    print("=" * 60)
    
    import requests
    
    graphdb_url = os.getenv('GRAPHDB_URL', 'http://start5g-1.cs.uit.no:7200')
    graphdb_repository = os.getenv('GRAPHDB_REPOSITORY', 'intents_and_intent_reports')
    
    query = """
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
    PREFIX data5g: <http://5g4data.eu/5g4data#>
    PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
    
    SELECT DISTINCT ?intent ?id ?type
    WHERE {
        ?intent a icm:Intent ;
            log:allOf ?extype .
        ?extype icm:target ?target .
        BIND(REPLACE(STR(?intent), ".*#I", "") AS ?id)
        BIND(IF(?target = data5g:network-slice, "Network",
                IF(?target = data5g:deployment, "Workload",
                IF(?target = data5g:network-slice && EXISTS { ?intent log:allOf data5g:RE2 }, "Combined", "Unknown"))) AS ?type)
    }        ORDER BY ?id
    """
    
    # Test with /sparql endpoint
    print("\n1. Testing with /sparql endpoint:")
    try:
        response = requests.post(
            f"{graphdb_url}/repositories/{graphdb_repository}/sparql",
            data=query.encode('utf-8'),
            headers={
                'Accept': 'application/sparql-results+json',
                'Content-Type': 'application/sparql-query'
            },
            timeout=30
        )
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            bindings = data.get('results', {}).get('bindings', [])
            print(f"   Found {len(bindings)} intents")
        else:
            print(f"   Error: {response.text}")
    except Exception as e:
        print(f"   Error: {e}")
    
    # Test without /sparql endpoint
    print("\n2. Testing without /sparql endpoint:")
    try:
        response = requests.post(
            f"{graphdb_url}/repositories/{graphdb_repository}",
            data=query.encode('utf-8'),
            headers={
                'Accept': 'application/sparql-results+json',
                'Content-Type': 'application/sparql-query'
            },
            timeout=30
        )
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            bindings = data.get('results', {}).get('bindings', [])
            print(f"   Found {len(bindings)} intents")
        else:
            print(f"   Error: {response.text}")
    except Exception as e:
        print(f"   Error: {e}")

if __name__ == '__main__':
    print("Intent Report Client Package Test")
    print("=" * 60)
    
    # Test the package
    success = test_get_intents()
    
    # Test direct query
    test_direct_query()
    
    print("\n" + "=" * 60)
    if success:
        print("Test completed")
    else:
        print("Test failed")
    print("=" * 60)

