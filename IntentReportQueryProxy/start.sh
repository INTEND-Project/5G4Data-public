#!/bin/bash

# Intent Report Query Proxy Startup Script

echo "Starting Intent Report Query Proxy..."

# Check if virtual environment exists
if [ ! -d "intent-report-proxy-env" ]; then
    echo "Creating virtual environment..."
    python3 -m venv intent-report-proxy-env
fi

# Activate virtual environment
source intent-report-proxy-env/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Load environment variables if .env file exists
if [ -f ".env" ]; then
    echo "Loading environment variables from .env..."
    export $(cat .env | grep -v '^#' | xargs)
fi

# Start the application
echo "Starting application..."
python run.py 