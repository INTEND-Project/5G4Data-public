"""Main entry point for Intent Generation MCP Server."""

import logging
import sys
from intent_generation_mcp.server import get_mcp

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('intent-generation-mcp-server.log')
    ]
)

logger = logging.getLogger(__name__)

if __name__ == "__main__":
    logger.info("Starting Intent Generation MCP Server on port 8082")
    mcp = get_mcp()
    mcp.run(transport="http", port=8082)
