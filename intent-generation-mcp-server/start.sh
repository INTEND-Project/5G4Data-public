#!/bin/bash

echo "Starting Intent Generation MCP Server..."
echo "Port: 8082"
echo "URL: http://localhost:8082/mcp"
echo ""

# Install dependencies if needed
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

# Start the server
echo "Starting server..."
python3 src/main.py
