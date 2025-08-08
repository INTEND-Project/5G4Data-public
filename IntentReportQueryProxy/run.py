#!/usr/bin/env python3
"""
Startup script for the Intent Report Query Proxy
"""

import os
import sys
from app import app

def main():
    """Start the Flask application with proper configuration"""
    
    # Configuration
    host = os.environ.get('FLASK_HOST', '0.0.0.0')
    port = int(os.environ.get('FLASK_PORT', 3010))
    debug = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    
    print(f"Starting Intent Report Query Proxy...")
    print(f"Host: {host}")
    print(f"Port: {port}")
    print(f"Debug: {debug}")
    print(f"GraphDB URL: {os.environ.get('GRAPHDB_URL', 'http://start5g-1.cs.uit.no:7200')}")
    print(f"Repository: {os.environ.get('GRAPHDB_REPOSITORY', 'intent-reports')}")
    print("-" * 50)
    
    try:
        app.run(
            host=host,
            port=port,
            debug=debug,
            threaded=True
        )
    except KeyboardInterrupt:
        print("\nShutting down gracefully...")
        sys.exit(0)
    except Exception as e:
        print(f"Error starting application: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 