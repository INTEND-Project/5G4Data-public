# Intent Generation MCP Server

A Model Context Protocol (MCP) server for generating TM Forum compliant intents for the 5G4Data use-case. Note that the MCP server is work in progress.

## Quick Start
1. **Start the MCP server**:
   ```bash
   ./start.sh
   ```
2. **Test the server**:
   ```bash
   python tests/test_generation_client.py --bandwidth 500 --latency 10
   ```
Note that there are a lot more options available for the test_generation_client.py script. Use the --help argument to see them all.

## Server Details

- **Port**: 8082
- **URL**: http://localhost:8082/mcp
- **Transport**: Streamable-HTTP
- **FastMCP Version**: 2.12.3
- **MCP SDK Version**: 1.14.1

## Available Tools

- `generate_intent(intent_type, slots)` - Generate any type of intent
- `generate_network_intent(slots)` - Generate network slice intent
- `generate_workload_intent(slots)` - Generate workload deployment intent
- `generate_combined_intent(slots)` - Generate combined intent
- `list_intent_types()` - List available intent types
- `get_intent_schema(intent_type)` - Get schema for intent type
- `validate_intent_slots(intent_type, slots)` - Validate intent parameters
- `generate_tmf921_payload(intent)` - Generate TMF921 API payload

## Intent Types

### Network Intent
- **Parameters**: latency, bandwidth, location, polygon, customer, etc.
- **Purpose**: Network slice configuration with QoS guarantees

### Workload Intent  
- **Parameters**: compute_latency, datacenter, application, descriptor, etc.
- **Purpose**: Workload deployment for cloud-native applications

### Combined Intent
- **Parameters**: All network + workload parameters
- **Purpose**: Simultaneous network and workload configuration

## Example Usage

```python
from fastmcp import Client

client = Client("http://localhost:8082/mcp")

# Generate network intent
result = await client.call_tool("generate_network_intent", {
    "slots": {
        "bandwidth": 500,
        "latency": 10,
        "location": "Oslo, Norway",
        "customer": "+4712345678"
    }
})
```

## Architecture

This MCP server uses the `intent-generator-package` for inline code-based intent generation, eliminating the need for template files. It provides a clean, single-purpose server focused solely on intent generation capabilities.
