#!/usr/bin/env python3
"""Proper test script for the SPARQL Query MCP Server using FastMCP Client."""

import asyncio
from fastmcp import Client

async def test_mcp_server_proper():
    """Test the MCP server using the FastMCP Client."""
    server_url = "http://localhost:8084/mcp"
    
    print("🧪 Testing SPARQL Query MCP Server (FastMCP Client)")
    print("=" * 60)
    
    client = Client(server_url)
    
    try:
        async with client:
            print("1. Connecting to SPARQL Query MCP Server...")
            
            # Test 1: List available tools
            print("\n2. Listing available tools...")
            try:
                tools = await client.list_tools()
                if isinstance(tools, list):
                    print(f"   ✅ Found {len(tools)} tools:")
                    for tool in tools:
                        name = tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", str(tool))
                        desc = tool.get("description") if isinstance(tool, dict) else getattr(tool, "description", "")
                        print(f"      - {name}: {desc}")
                else:
                    print(f"   Tools response: {tools}")
            except Exception as e:
                print(f"   ❌ Failed to list tools: {e}")
            
            # Test 2: Test get_graphdb_info tool
            print("\n3. Testing get_graphdb_info tool...")
            try:
                result = await client.call_tool("get_graphdb_info", {})
                if "graphdb_url" in result.data:
                    print(f"   ✅ GraphDB connection info:")
                    print(f"      - URL: {result.data.get('graphdb_url', 'unknown')}")
                    print(f"      - Repository: {result.data.get('repository_id', 'unknown')}")
                    print(f"      - Status: {result.data.get('connection_status', 'unknown')}")
                    if result.data.get('test_query_result'):
                        print(f"      - Test result: {result.data['test_query_result']}")
                else:
                    print(f"   Response: {result.data}")
            except Exception as e:
                print(f"   ❌ GraphDB info error: {e}")
            
            # Test 3: Test SPARQL query execution
            print("\n4. Testing SPARQL query execution...")
            try:
                query = "PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> SELECT (COUNT(?intent) AS ?intentCount) WHERE { ?intent a icm:Intent . }"
                result = await client.call_tool("execute_sparql_query", {
                    "query": query,
                    "format": "json"
                })
                
                if result.data.get("success"):
                    print(f"   ✅ SPARQL query executed successfully:")
                    print(f"      - Results: {result.data.get('results', 'no results')}")
                    print(f"      - Execution time: {result.data.get('execution_time_ms', 'unknown')}ms")
                else:
                    print(f"   ❌ SPARQL query failed: {result.data.get('error', 'unknown error')}")
            except Exception as e:
                print(f"   ❌ SPARQL query error: {e}")
            
            # Test 4: Test health check tool
            print("\n5. Testing health check tool...")
            try:
                result = await client.call_tool("health_check", {})
                if result.data.get("status"):
                    print(f"   ✅ Health check completed:")
                    print(f"      - Status: {result.data.get('status', 'unknown')}")
                    print(f"      - Services: {result.data.get('services', {})}")
                else:
                    print(f"   Response: {result.data}")
            except Exception as e:
                print(f"   ❌ Health check error: {e}")
            
            # Test 5: Test query validation
            print("\n6. Testing SPARQL query validation...")
            try:
                test_query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10"
                result = await client.call_tool("validate_sparql_query", {
                    "query": test_query
                })
                
                if result.data.get("validation"):
                    validation = result.data["validation"]
                    print(f"   ✅ Query validation completed:")
                    print(f"      - Valid: {validation.get('valid', 'unknown')}")
                    print(f"      - Warnings: {validation.get('warnings', [])}")
                    print(f"      - Suggestions: {validation.get('suggestions', [])}")
                else:
                    print(f"   Response: {result.data}")
            except Exception as e:
                print(f"   ❌ Query validation error: {e}")
            
            # Test 6: Test ontology info
            print("\n7. Testing ontology info...")
            try:
                result = await client.call_tool("get_ontology_info", {})
                if result.data.get("repository"):
                    print(f"   ✅ Ontology info retrieved:")
                    print(f"      - Repository: {result.data.get('repository', 'unknown')}")
                    print(f"      - Status: {result.data.get('status', 'unknown')}")
                    print(f"      - Queries executed: {result.data.get('queries_executed', 'unknown')}")
                else:
                    print(f"   Response: {result.data}")
            except Exception as e:
                print(f"   ❌ Ontology info error: {e}")
            
    except Exception as e:
        print(f"❌ Connection error: {e}")
        print("\nMake sure the SPARQL Query MCP Server is running:")
        print("  cd ../sparql-query-mcp-server && python src/main.py")
    
    print("\n" + "=" * 60)
    print("🏁 FastMCP Client test completed!")

if __name__ == "__main__":
    asyncio.run(test_mcp_server_proper())
