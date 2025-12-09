#!/bin/bash
# Build script for inServ Docker image with no cache

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Building inServ Docker image (no cache) ==="
echo ""

# Check if intent-report-client exists in parent directory
if [ ! -d "../intent-report-client" ]; then
    echo "ERROR: intent-report-client not found in ../intent-report-client/"
    echo "Please ensure the intent-report-client package exists in the parent directory"
    exit 1
fi

echo "Building Docker image from parent directory context (required for intent-report-client)..."
cd ..
docker build --no-cache -f inServ/Dockerfile -t inserv .

echo ""
echo "=== Build complete! ==="
echo ""
echo "To run the container (use --network host if GraphDB is on the host):"
echo "  docker run --network host \\"
echo "    -e GRAPHDB_BASE_URL=http://start5g-1.cs.uit.no:7200 \\"
echo "    -e GRAPHDB_REPOSITORY=intents_and_intent_reports \\"
echo "    inserv"
echo ""
echo "Alternative (if GraphDB is accessible from bridge network):"
echo "  docker run -p 3021:3021 \\"
echo "    -e GRAPHDB_BASE_URL=http://start5g-1.cs.uit.no:7200 \\"
echo "    -e GRAPHDB_REPOSITORY=intents_and_intent_reports \\"
echo "    inserv"
echo ""
