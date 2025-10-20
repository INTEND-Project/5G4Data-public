"""SPARQL Query MCP Server."""

from fastmcp import FastMCP

from .tools import register_sparql_tools


def get_mcp() -> FastMCP:
    """Create and configure the SPARQL Query MCP server."""
    mcp = FastMCP("SPARQL Query MCP Server")
    
    # Register SPARQL-specific tools
    register_sparql_tools(mcp)
    
    return mcp