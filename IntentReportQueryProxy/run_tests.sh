#!/bin/bash

# Test script for bandwidth metrics with time constraints
echo "Running bandwidth metrics tests..."

# Check if the Flask app is running
if ! curl -s http://localhost:3010/health > /dev/null; then
    echo "Flask app is not running. Starting it..."
    python app.py &
    APP_PID=$!
    sleep 3
fi

# Run the comprehensive test suite
echo "Running comprehensive bandwidth metrics tests..."
python test_app.py --url http://localhost:3010 --wait 0

# Run specific bandwidth tests
echo ""
echo "Running specific bandwidth time constraint tests..."
python test_app.py --url http://localhost:3010 --wait 0

# Clean up if we started the app
if [ ! -z "$APP_PID" ]; then
    echo "Stopping Flask app..."
    kill $APP_PID
fi

echo "Tests completed!" 