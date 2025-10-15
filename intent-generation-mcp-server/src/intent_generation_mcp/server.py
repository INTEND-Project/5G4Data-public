"""Intent Generation MCP Server."""

from fastmcp import FastMCP

from .tools import register_generation_tools


def get_mcp() -> FastMCP:
    """Create and configure the Intent Generation MCP server."""
    mcp = FastMCP("Intent Generation MCP Server")
    
    # Register generation-specific tools
    register_generation_tools(mcp)
    
    return mcp
