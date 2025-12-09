#!/bin/bash
# Helper script to run query_rusty_llm.py with the virtual environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment
source venv/bin/activate

# Run the script
python3 query_rusty_llm.py "$@"

# Deactivate virtual environment when script exits
deactivate

