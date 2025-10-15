#!/usr/bin/env python3
"""
Test client for Intent Generation MCP Server using intent-generator-package
Tests different quantifier identifiers and intent types

Usage:
    python test_generation_client.py
    python test_generation_client.py --test-all
    python test_generation_client.py --test-operators
    python test_generation_client.py --test-intent-types
    python test_generation_client.py --test-prompts
    python test_generation_client.py --test-list
    python test_generation_client.py --help
"""

import asyncio
import argparse
from fastmcp import Client

def parse_arguments():
    """Parse command line arguments for test configuration."""
    parser = argparse.ArgumentParser(
        description="Test client for Intent Generation MCP Server with quantifier identifier testing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_generation_client.py                    # Run basic test
  python test_generation_client.py --test-all         # Run all tests
  python test_generation_client.py --test-operators  # Test different operators
  python test_generation_client.py --test-intent-types # Test different intent types
  python test_generation_client.py --test-prompts     # Test MCP prompts listing and retrieval
  python test_generation_client.py --test-list       # Only list available tools and exit
        """
    )
    
    parser.add_argument(
        "--test-all", 
        action="store_true",
        help="Run all tests (operators and intent types)"
    )
    parser.add_argument(
        "--test-operators", 
        action="store_true",
        help="Test different quantifier operators"
    )
    parser.add_argument(
        "--test-intent-types", 
        action="store_true",
        help="Test different intent types (network, workload, combined)"
    )
    parser.add_argument(
        "--test-prompts",
        action="store_true",
        help="Test MCP prompts (list and fetch initial + welcome prompts)"
    )
    parser.add_argument(
        "--test-list",
        action="store_true",
        help="Only list available tools on the server and exit"
    )
    parser.add_argument(
        "--server-url", 
        type=str,
        default="http://localhost:8082/mcp",
        help="MCP server URL (default: http://localhost:8082/mcp)"
    )
    
    return parser.parse_args()

async def test_basic_network_intent(client, server_url):
    """Test basic network intent generation."""
    print("=== Test 1: Basic Network Intent ===")
    
    slots = {
        "bandwidth": 500,
        "latency": 20,
        "latency_operator": "smaller",
        "bandwidth_operator": "larger",
        "polygon": "(69.670000 18.917000, 69.670000 18.927000, 69.665000 18.927000, 69.665000 18.917000)",
        "customer": "+4790924546",
        "handler": "inSwitch",
        "owner": "inNet",
        "description": "Basic network slice test"
    }
    
    print("Parameters:", slots)
    
    result = await client.call_tool("generate_network_intent", {"slots": slots})
    
    print("Generated Intent:")
    print("=" * 60)
    if "generated_intent" in result.data:
        intent_lines = result.data["generated_intent"].split('\n')
        for line in intent_lines:
            print(f"  {line}")
    else:
        print(f"  Error: {result.data}")
    print("=" * 60)
    print()

async def test_quantifier_operators(client, server_url):
    """Test different quantifier operators."""
    print("=== Test 2: Quantifier Operators ===")
    
    operators = [
        ("smaller", "atLeast"),
        ("larger", "atMost"), 
        ("greater", "inRange"),
        ("mean", "median")
    ]
    
    for latency_op, bandwidth_op in operators:
        print(f"\n--- Testing {latency_op} (latency) and {bandwidth_op} (bandwidth) ---")
        
        slots = {
            "bandwidth": 300,
            "latency": 25,
            "latency_operator": latency_op,
            "bandwidth_operator": bandwidth_op,
            "polygon": "(69.670000 18.917000, 69.670000 18.927000, 69.665000 18.927000, 69.665000 18.917000)",
            "customer": "+4790924546",
            "handler": "inSwitch",
            "owner": "inNet",
            "description": f"Test with {latency_op} latency and {bandwidth_op} bandwidth"
        }
        
        # Add end values for inRange operator
        if latency_op == "inRange":
            slots["latency_end"] = 30
        if bandwidth_op == "inRange":
            slots["bandwidth_end"] = 400
        
        print(f"Parameters: latency_operator={latency_op}, bandwidth_operator={bandwidth_op}")
        
        result = await client.call_tool("generate_network_intent", {"slots": slots})
        
        if "generated_intent" in result.data:
            # Check if the generated intent contains the expected quantifier
            intent_text = result.data["generated_intent"]
            if f"quan:{latency_op}" in intent_text:
                print(f"✅ Latency operator '{latency_op}' found in generated intent")
            else:
                print(f"❌ Latency operator '{latency_op}' NOT found in generated intent")
                
            if f"quan:{bandwidth_op}" in intent_text:
                print(f"✅ Bandwidth operator '{bandwidth_op}' found in generated intent")
            else:
                print(f"❌ Bandwidth operator '{bandwidth_op}' NOT found in generated intent")
        else:
            print(f"❌ Error: {result.data}")
    
    print()

async def test_intent_types(client, server_url):
    """Test different intent types."""
    print("=== Test 3: Different Intent Types ===")
    
    # Test Network Intent
    print("\n--- Network Intent ---")
    network_slots = {
        "bandwidth": 500,
        "latency": 20,
        "latency_operator": "smaller",
        "bandwidth_operator": "larger",
        "polygon": "(69.670000 18.917000, 69.670000 18.927000, 69.665000 18.927000, 69.665000 18.917000)",
        "customer": "+4790924546",
        "handler": "inSwitch",
        "owner": "inNet",
        "description": "Network slice for AR application"
    }
    
    result = await client.call_tool("generate_network_intent", {"slots": network_slots})
    if "generated_intent" in result.data:
        print("✅ Network intent generated successfully")
    else:
        print(f"❌ Network intent failed: {result.data}")
    
    # Test Workload Intent
    print("\n--- Workload Intent ---")
    workload_slots = {
        "compute_latency": 15,
        "compute_latency_operator": "smaller",
        "datacenter": "EC1",
        "application": "AR-retail-app",
        "descriptor": "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml",
        "customer": "+4790924546",
        "handler": "inSwitch",
        "owner": "inNet",
        "description": "Workload deployment for AR retail application"
    }
    
    result = await client.call_tool("generate_workload_intent", {"slots": workload_slots})
    if "generated_intent" in result.data:
        print("✅ Workload intent generated successfully")
    else:
        print(f"❌ Workload intent failed: {result.data}")
    
    # Test Combined Intent
    print("\n--- Combined Intent ---")
    combined_slots = {
        "bandwidth": 300,
        "latency": 20,
        "latency_operator": "smaller",
        "bandwidth_operator": "larger",
        "compute_latency": 15,
        "compute_latency_operator": "smaller",
        "datacenter": "EC2",
        "application": "VR-gaming-app",
        "polygon": "(69.670000 18.917000, 69.670000 18.927000, 69.665000 18.927000, 69.665000 18.917000)",
        "customer": "+4790924546",
        "handler": "inSwitch",
        "owner": "inNet",
        "description": "Combined network and workload intent for VR gaming"
    }
    
    result = await client.call_tool("generate_combined_intent", {"slots": combined_slots})
    if "generated_intent" in result.data:
        print("✅ Combined intent generated successfully")
    else:
        print(f"❌ Combined intent failed: {result.data}")
    
    print()

async def test_inrange_operator(client, server_url):
    """Test inRange operator with end values."""
    print("=== Test 4: inRange Operator with End Values ===")
    
    slots = {
        "bandwidth": 200,
        "bandwidth_operator": "inRange",
        "bandwidth_end": 400,
        "latency": 10,
        "latency_operator": "inRange", 
        "latency_end": 30,
        "polygon": "(69.670000 18.917000, 69.670000 18.927000, 69.665000 18.927000, 69.665000 18.917000)",
        "customer": "+4790924546",
        "handler": "inSwitch",
        "owner": "inNet",
        "description": "Network slice with inRange operators"
    }
    
    print("Parameters:", slots)
    
    result = await client.call_tool("generate_network_intent", {"slots": slots})
    
    if "generated_intent" in result.data:
        intent_text = result.data["generated_intent"]
        print("Generated Intent:")
        print("=" * 60)
        intent_lines = intent_text.split('\n')
        for line in intent_lines:
            print(f"  {line}")
        print("=" * 60)
        
        # Check for inRange patterns
        if "quan:inRange" in intent_text:
            print("✅ inRange operator found in generated intent")
        else:
            print("❌ inRange operator NOT found in generated intent")
            
        if "10 to 30" in intent_text:
            print("✅ Latency range (10 to 30) found in generated intent")
        else:
            print("❌ Latency range (10 to 30) NOT found in generated intent")
            
        if "200 to 400" in intent_text:
            print("✅ Bandwidth range (200 to 400) found in generated intent")
        else:
            print("❌ Bandwidth range (200 to 400) NOT found in generated intent")
    else:
        print(f"❌ Error: {result.data}")
    
    print()

async def test_schema_validation(client, server_url):
    """Test schema validation and listing."""
    print("=== Test 5: Schema Validation ===")
    
    # Test list_intent_types
    print("\n--- List Intent Types ---")
    result = await client.call_tool("list_intent_types", {})
    if "intent_types" in result.data:
        print("✅ Intent types listed successfully")
        for intent_type in result.data["intent_types"]:
            print(f"   - {intent_type['type']}: {intent_type['description']}")
    else:
        print(f"❌ Failed to list intent types: {result.data}")
    
    # Test get_intent_schema
    print("\n--- Get Intent Schema ---")
    result = await client.call_tool("get_intent_schema", {"intent_type": "network"})
    if "type" in result.data and result.data["type"] == "network":
        print("✅ Network intent schema retrieved successfully")
        print(f"   Available operators: {list(result.data.get('operators', {}).keys())}")
    else:
        print(f"❌ Failed to get network schema: {result.data}")
    
    # Test validate_intent_slots
    print("\n--- Validate Intent Slots ---")
    test_slots = {
        "bandwidth": 500,
        "latency": 20,
        "latency_operator": "smaller",
        "bandwidth_operator": "larger",
        "invalid_field": "should_fail"
    }
    
    result = await client.call_tool("validate_intent_slots", {
        "intent_type": "network",
        "slots": test_slots
    })
    
    if "valid" in result.data:
        if result.data["valid"]:
            print("❌ Validation should have failed for invalid field")
        else:
            print("✅ Validation correctly failed for invalid field")
            print(f"   Errors: {result.data.get('errors', [])}")
    else:
        print(f"❌ Validation failed: {result.data}")
    
    print()

async def run_tests(args):
    """Run the specified tests."""
    server_url = args.server_url
    
    print("=== Intent Generation MCP Client Test Suite ===")
    print(f"Server URL: {server_url}")
    print()
    
    client = Client(server_url)
    
    try:
        async with client:
            print("1. Connecting to Intent Generation MCP Server...")
            
            # List tools available on the server
            print("\n=== Tools/List ===")
            try:
                tools = await client.list_tools()
                # tools is typically a list of dicts with name/description
                if isinstance(tools, list):
                    print(f"Found {len(tools)} tools:")
                    for t in tools:
                        name = t.get("name") if isinstance(t, dict) else getattr(t, "name", str(t))
                        desc = t.get("description") if isinstance(t, dict) else getattr(t, "description", "")
                        print(f"  - {name}: {desc}")
                else:
                    print(tools)
            except Exception as e:
                print(f"Failed to list tools: {e}")

            # Prompts tests if requested
            if getattr(args, "test_prompts", False):
                print("\n=== Prompts ===")
                try:
                    if hasattr(client, "list_prompts"):
                        prompts = await client.list_prompts()
                        if isinstance(prompts, list):
                            print(f"Found {len(prompts)} prompts:")
                            for p in prompts:
                                name = p.get("name") if isinstance(p, dict) else getattr(p, "name", str(p))
                                desc = p.get("description") if isinstance(p, dict) else getattr(p, "description", "")
                                print(f"  - {name}: {desc}")
                        else:
                            print(prompts)
                    else:
                        print("Client does not support list_prompts()")

                    # Try to fetch both known prompts explicitly if supported
                    for prompt_name in [
                        "intent_generation_initial_prompt",
                        "5g4data_welcome",
                    ]:
                        try:
                            if hasattr(client, "get_prompt"):
                                prompt = await client.get_prompt(prompt_name)
                                print(f"\nPrompt '{prompt_name}':")
                                print(prompt)
                            else:
                                print(f"Client does not support get_prompt(); cannot fetch '{prompt_name}'")
                        except Exception as e:
                            print(f"Failed to get prompt '{prompt_name}': {e}")
                except Exception as e:
                    print(f"Failed prompts test: {e}")

                # In prompts-only mode, return immediately after testing prompts
                if not (args.test_all or args.test_operators or args.test_intent_types):
                    print("\n=== Prompts test completed ===")
                    return
            
            # If only listing is requested, exit early without running other tests
            if args.test_list:
                print("\n=== List-only mode complete ===")
                return
            
            # Always run basic test
            await test_basic_network_intent(client, server_url)
            
            # Run additional tests based on arguments
            if args.test_all or args.test_operators:
                await test_quantifier_operators(client, server_url)
                await test_inrange_operator(client, server_url)
            
            if args.test_all or args.test_intent_types:
                await test_intent_types(client, server_url)
            
            if args.test_all:
                await test_schema_validation(client, server_url)
            
            print("=== Test Suite Completed ===")
            
    except Exception as e:
        print(f"Error: {e}")
        print("\nMake sure the Intent Generation MCP Server is running:")
        print("  ./start.sh")

async def main():
    """Main function to run the test."""
    args = parse_arguments()
    await run_tests(args)

if __name__ == "__main__":
    asyncio.run(main())
