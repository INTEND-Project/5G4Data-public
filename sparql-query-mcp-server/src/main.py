"""Main entry point for SPARQL Query MCP Server."""

import argparse
import logging
import sys
from sparql_query_mcp.server import get_mcp

def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="SPARQL Query MCP Server")
    parser.add_argument(
        "--debug", 
        action="store_true", 
        help="Enable debug output for SPARQL queries and results"
    )
    parser.add_argument(
        "--port", 
        type=int, 
        default=8084, 
        help="Port to run the server on (default: 8084)"
    )
    return parser.parse_args()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('sparql-query-mcp-server.log')
    ]
)

logger = logging.getLogger(__name__)

if __name__ == "__main__":
    args = parse_args()
    
    # Set debug mode globally
    import os
    os.environ["SPARQL_DEBUG"] = "true" if args.debug else "false"
    
    if args.debug:
        logger.info("Debug mode enabled - SPARQL queries and results will be logged")
    
    logger.info(f"Starting SPARQL Query MCP Server on port {args.port}")
    mcp = get_mcp()
    mcp.run(transport="http", port=args.port)
