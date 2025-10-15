# SPARQL Query MCP Server

A Model Context Protocol (MCP) server that provides SPARQL query capabilities for GraphDB knowledge graphs. This server exposes SPARQL query tools that can be used by AI systems to interact with GraphDB repositories.

## Features

- **SPARQL Query Execution**: Execute SPARQL queries against GraphDB repositories
- **Query Validation**: Validate SPARQL syntax before execution
- **Ontology Information**: Get information about available classes, properties, and prefixes
- **Health Monitoring**: Check server and GraphDB connection status
- **Multiple Formats**: Support for JSON, XML, CSV, and TSV response formats
- **HTTP Transport**: Runs as an HTTP server for easy integration

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   pip install -e .
   ```

## Configuration

The server uses environment variables for configuration. Copy `config.env.example` to `.env` and modify as needed:

```bash
cp config.env.example .env
```

### Environment Variables

- `GRAPHDB_URL`: GraphDB base URL (default: http://start5g-1.cs.uit.no:7200)
- `GRAPHDB_REPOSITORY_ID`: Repository ID to query (default: intents_and_intent_reports)
- `GRAPHDB_USERNAME`: Username for authentication (optional)
- `GRAPHDB_PASSWORD`: Password for authentication (optional)

## Usage

### Starting the Server

```bash
python src/main.py
```

The server will start on port 8083 by default.

### Available Tools

1. **execute_sparql_query**: Execute SPARQL queries against GraphDB
2. **validate_sparql_query**: Validate SPARQL syntax
3. **get_graphdb_info**: Get connection and repository information
4. **get_ontology_info**: Get ontology schema information
5. **health_check**: Check server and GraphDB status

### Example SPARQL Queries

```sparql
# Count all intents
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
SELECT (COUNT(?intent) AS ?intentCount) WHERE {
  ?intent a icm:Intent .
}

# Find all expectations
PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
SELECT ?expectation ?type WHERE {
  ?expectation a icm:Expectation .
  ?expectation a ?type .
}

# Get observations with values
PREFIX met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/>
SELECT ?obs ?metric ?value ?timestamp WHERE {
  ?obs a met:Observation .
  ?obs met:observedMetric ?metric .
  ?obs met:observedValue ?value .
  ?obs met:obtainedAt ?timestamp .
}
```

## Integration with AI Systems

This MCP server can be integrated with AI systems that support the Model Context Protocol. The server exposes tools that AI systems can call to:

- Execute SPARQL queries based on natural language requests
- Validate queries before execution
- Get information about the knowledge graph structure
- Monitor server health and connectivity

## Development

### Project Structure

```
src/
├── main.py                 # Server entry point
└── sparql_query_mcp/
    ├── __init__.py
    ├── server.py           # FastMCP server setup
    └── tools.py            # SPARQL tools implementation
```

### Adding New Tools

To add new SPARQL-related tools:

1. Add the tool function to `tools.py`
2. Register it in the `register_sparql_tools` function
3. Use the `@mcp.tool` decorator for automatic registration

### Testing

Run the health check to verify the server is working:

```bash
curl http://localhost:8083/health
```

## License

This project is part of the INTEND Project 5G4Data initiative.
