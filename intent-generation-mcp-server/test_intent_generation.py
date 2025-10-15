#!/usr/bin/env python3
"""
Quick test script to verify intent generation works with the fixes.
"""

import asyncio
import json
import time
from fastmcp import Client

async def test_mcp_server():
    """Test the MCP server using FastMCP Client."""
    server_url = "http://127.0.0.1:8082/mcp"
    
    print("Testing MCP Server Intent Generation...")
    
    # Test data from the conversation
    test_slots = {
        "latency": 35,
        "latency_operator": "smaller", 
        "bandwidth": 300,
        "bandwidth_operator": "larger",
        "location": "Romssa Arena",
        "description": "AR goggles event at Romssa Arena"
    }
    
    print(f"Test slots: {json.dumps(test_slots, indent=2)}")
    
    try:
        # Create FastMCP client and use async context manager
        async with Client(server_url) as client:
            # Test health check first
            try:
                health_result = await client.call_tool("health_check", {})
                print(f"Health check result: {health_result.data}")
            except Exception as e:
                print(f"Health check failed: {e}")
                return False
            
            # Test network intent generation
            try:
                result = await client.call_tool("generate_network_intent", {"slots": test_slots})
                
                if "generated_intent" in result.data:
                    generated_intent = result.data["generated_intent"]
                    print(f"Success! Generated intent length: {len(generated_intent)}")
                    print("\nGenerated Intent:")
                    print("=" * 60)
                    print(generated_intent)
                    print("=" * 60)
                    return True
                else:
                    print(f"Error in result: {result.data}")
                    return False
                    
            except Exception as e:
                print(f"Network intent generation failed: {e}")
                return False
                
    except Exception as e:
        print(f"Client connection failed: {e}")
        return False

async def main():
    """Main async function to run the test."""
    print("Starting MCP Server Test...")
    print("Make sure the MCP server is running: python src/main.py")
    print()
    
    # Wait a moment for user to start server
    time.sleep(2)
    
    success = await test_mcp_server()
    
    if success:
        print("\n✅ Test passed! Intent generation is working.")
    else:
        print("\n❌ Test failed! Check the server logs.")

if __name__ == "__main__":
    asyncio.run(main())
