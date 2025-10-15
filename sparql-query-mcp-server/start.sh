#!/bin/bash

# Start SPARQL Query MCP Server
echo "Starting SPARQL Query MCP Server..."

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    if [ $? -ne 0 ]; then
        echo "Failed to create virtual environment"
        exit 1
    fi
fi

# Activate virtual environment
source .venv/bin/activate
if [ $? -ne 0 ]; then
    echo "Failed to activate virtual environment"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
pip install -e .
if [ $? -ne 0 ]; then
    echo "Failed to install dependencies"
    exit 1
fi

# Set default values if not set
export GRAPHDB_URL=${GRAPHDB_URL:-"http://start5g-1.cs.uit.no:7200"}
export GRAPHDB_REPOSITORY_ID=${GRAPHDB_REPOSITORY_ID:-"intents_and_intent_reports"}
export MCP_SERVER_PORT=${MCP_SERVER_PORT:-8084}

echo "Configuration:"
echo "  GraphDB URL: $GRAPHDB_URL"
echo "  Repository: $GRAPHDB_REPOSITORY_ID"
echo "  Server Port: $MCP_SERVER_PORT"
echo "  Username: ${GRAPHDB_USERNAME:-"not set"}"
echo ""

# Parse command line arguments
DEBUG_MODE=""
PORT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --debug)
            DEBUG_MODE="--debug"
            shift
            ;;
        --port)
            PORT="--port $2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--debug] [--port PORT]"
            echo ""
            echo "Options:"
            echo "  --debug     Enable debug output for SPARQL queries and results"
            echo "  --port PORT Port to run the server on (default: 8084)"
            echo "  --help, -h  Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            echo "Usage: $0 [--debug] [--port PORT]"
            echo "Use --help for more information"
            exit 1
            ;;
    esac
done

# Start the server
echo "Starting server with arguments: $DEBUG_MODE $PORT"
python src/main.py $DEBUG_MODE $PORT
