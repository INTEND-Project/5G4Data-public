# GraphDB Dialogue Agent

A conversational agent that allows users to interact with GraphDB through natural language.

## Features

🤖 **Natural Language Processing**: Ask questions about your graph data in plain English  
🔍 **SPARQL Query Generation**: Automatically converts questions to SPARQL queries  

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

Alternatively, create a `client.yaml` file manually with your GraphDB configuration:

```yaml
openai:
  # Set this to your OpenAI API key
  api_key: your-openai-api-key

# System prompt is now loaded from system_prompt.txt file

graphdb:
  # The base URL of the GraphDB instance
  url: http://your-graphdb-instance:7200
  
  # GraphDB repository ID
  repository_id: your-repository-id

  # GraphDB username to associate with created threads and use for HTTP basic auth
  username: your-username

  # Set this to use HTTP basic auth (with the above username)
  password: your-password

  # Set this to use a custom HTTP authorization header (for example, GraphDB or OpenID token)
  auth_header:

# Model configuration
model_name: gpt-4o

# TTYG REST API configuration, only used if --mcp or --direct is not set. 
# The dialogue agent will then use the GraphDB Lab TTYG agent. 
# You will have to create the agent in GraphDB GUI first.
ttyg:
  # The base URL of the GraphDB instance
  base_url: http://your-graphdb-instance:7200
  
  # TTYG agent ID
  agent_id: your-ttyg-agent-id
  
  # Authentication (optional)
  username: your-username
  password: your-password
```

## Usage

The dialogue agent can connect to the GraphDB knowledge graph in three different ways. You can specify command line arguments to configure how it connects:
  --direct         Use direct GraphDB SPARQL endpoint instead of TTYG agent
  --mcp            Use MCP server for SPARQL queries instead of TTYG agent
If neither of these two arguments are used, the agent will connect to a preconfigured GraphDB provided agent that is part of their lab environment. This used to be the only option. Since the GraphDB provided agent is still work in progress (from the GraphDB vendor) the two other options were introduced and is currently the recomended options. The --direct option works out of the box since the dialogue agent will then use internal tools created using langgraph. The --mcp options requires that the sparql-query-mcp-server is running. The dialogue agent will then use tools provided by the mcp server to interact with the knowledge graph.

```bash
python ttyg_dialogue_agent.py --direct
```

