# MCP-based GraphDB Dialogue Agent

A conversational agent that allows users to interact with GraphDB through natural language using the Model Context Protocol (MCP).

## Features

🤖 **Natural Language Processing**: Ask questions about your graph data in plain English  
🔍 **SPARQL Query Generation**: Automatically converts questions to SPARQL queries  
🔗 **MCP Integration**: Uses Model Context Protocol for secure and efficient GraphDB communication

## Installation

**Manual Setup:**
1. Create and activate a virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install the required dependencies:
```bash
pip install -r requirements.txt
```

## Configuration

### Quick Setup

1. Copy the example configuration file:
```bash
cp client.yaml.example client.yaml
```

2. Edit `client.yaml` with your actual configuration values.

### Manual Configuration

Alternatively, create a `client.yaml` file manually with your configuration:

```yaml
openai:
  # Set this to your OpenAI API key
  api_key: your-openai-api-key

# System prompt is now loaded from system_prompt.txt file

# Model configuration
model_name: gpt-4o

# MCP server configuration
mcp_server_url: http://localhost:8084/mcp
```

## Usage

This dialogue agent uses the Model Context Protocol (MCP) to communicate with GraphDB. You need to have an MCP server running that provides SPARQL query capabilities.

```bash
python ttyg_dialogue_agent.py
```

### Command Line Options

- `--sparql-only`: Print SPARQL queries instead of executing them (useful for debugging)
- `--config CONFIG`: Path to YAML configuration file (default: client.yaml)

### Example Usage

```bash
# Run with default configuration
python ttyg_dialogue_agent.py

# Run in SPARQL-only mode (for debugging queries)
python ttyg_dialogue_agent.py --sparql-only

# Use a custom configuration file
python ttyg_dialogue_agent.py --config my_config.yaml
```

## Requirements

- Python 3.8+
- OpenAI API key
- Running MCP server with SPARQL capabilities
- FastMCP library (installed via requirements.txt)

## MCP Server

This agent requires an MCP server that provides SPARQL query execution capabilities. The MCP server should expose a tool called `execute_sparql_query` that accepts SPARQL queries and returns results.

Make sure your MCP server is running and accessible at the URL specified in your `client.yaml` configuration file.