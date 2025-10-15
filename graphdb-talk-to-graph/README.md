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

### Interactive Mode

You have two options for starting a conversation:

**Option 1: TTYG Library Agent (Original)**
```bash
python graphdb_dialogue_agent.py
```

**Option 2: TTYG REST API Agent (New)**
```bash
python ttyg_dialogue_agent.py
```

### Programmatic Usage

```python
from graphdb_dialogue_agent import GraphDBDialogueAgent, DialogueAgentConfig

# Create configuration
config = DialogueAgentConfig(
    openai_api_key="your-api-key",
    graphdb_url="http://your-graphdb:7200",
    graphdb_repository="your-repo-id"
)

# Create and use the agent
agent = GraphDBDialogueAgent(config)
response = agent.chat("What types of entities are in the graph?")
print(response)
```

### Testing

Run the test script to verify everything works:

```bash
python test_dialogue_agent.py test
```

### Demo

See a demonstration of the agent's capabilities:

```bash
python demo_agent.py
```

### Repository Discovery

If you're unsure about the repository ID, use the discovery utility:

```bash
python discover_repositories.py
```

This will show you all available repositories on your GraphDB instance.

## Available Tools

The agent has access to several tools for interacting with GraphDB:

- **sparql_query**: Execute SPARQL SELECT, CONSTRUCT, DESCRIBE, or ASK queries
- **autocomplete_search**: Find entities using GraphDB's autocomplete (if enabled)
- **full_text_search**: Search content using keywords (if FTS is enabled)
- **iri_discovery**: Discover IRIs and namespaces in your graph

## Example Conversations

```
👤 User: Hello! Can you tell me about the data in this GraphDB instance?
🤖 Quadro: Hello! I'm Quadro, your GraphDB assistant. I can help you explore and query your graph data using natural language...

👤 User: What types of entities are stored in the graph?
🤖 Quadro: Let me explore your graph to understand the entity types. I'll use SPARQL queries to discover the classes and their relationships...

👤 User: Can you show me some sample data?
🤖 Quadro: I'll retrieve some sample data from your graph. Let me query for a few instances with their properties...
```

## Architecture

The agent is built using:

- **[ttyg](https://pypi.org/project/ttyg/)**: GraphDB integration library
- **[LangGraph](https://github.com/langchain-ai/langgraph)**: Stateful agent framework
- **[LangChain](https://github.com/langchain-ai/langchain)**: LLM integration
- **[OpenAI](https://openai.com/)**: Language model provider

## Files

- `graphdb_dialogue_agent.py`: Main agent implementation (ttyg library)
- `ttyg_dialogue_agent.py`: Alternative agent implementation (TTYG REST API)
- `test_dialogue_agent.py`: Test script for ttyg library agent
- `test_ttyg_agent.py`: Test script for TTYG REST API agent
- `demo_agent.py`: Demonstration script
- `discover_repositories.py`: Repository discovery utility
- `client.yaml`: Configuration file
- `requirements.txt`: Python dependencies
- `setup.sh`: Automated setup script for virtual environment
- `activate.sh`: Virtual environment activation script
- `venv/`: Virtual environment directory (created during setup)
- `.gitignore`: Git ignore file for virtual environment and temporary files

## Troubleshooting

### Connection Issues

If you encounter connection issues:

1. Verify your GraphDB instance is running and accessible
2. Check the repository ID in your configuration
3. Ensure authentication credentials are correct
4. Test the connection manually using the GraphDB workbench

### Repository Not Found

If you get "Unknown repository" errors:

1. Verify the repository ID exists in your GraphDB instance
2. Check the repository permissions
3. Ensure the repository is not empty (some tools require data)

## Contributing

This agent is designed to be extensible. You can:

- Add new tools by extending the `_setup_tools()` method
- Customize the system prompt for your domain
- Add new conversation features
- Integrate with other GraphDB features

## License

This project is part of the INTEND Project and follows the same licensing terms.
