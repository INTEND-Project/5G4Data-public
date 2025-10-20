"""
MCP-based GraphDB Dialogue Agent

A conversational agent that interacts with GraphDB through an MCP server.
This agent uses the Model Context Protocol to communicate with GraphDB.
"""

import os
import sys
import yaml
import requests
import json
import base64
import asyncio
import webbrowser
import re
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta

# OpenAI imports
from openai import OpenAI

# MCP imports
try:
    from fastmcp import Client as MCPClient
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    MCPClient = None


@dataclass
class IntentAgentConfig:
    """Configuration for the MCP-based dialogue agent."""
    openai_api_key: str
    model_name: str = "gpt-4o"
    max_conversation_turns: int = 50
    # MCP server settings
    mcp_server_url: str = "http://start5g-1.cs.uit.no:8084/mcp"
    # Grafana settings
    grafana_base_url: str = "http://start5g-1.cs.uit.no:3001"
    grafana_dashboard_uid: str = "fekk4b61d38qof"
    grafana_dashboard_id: str = "5d08eee"
    # Context management settings
    max_conversation_history: int = 8  # Reduced from 20 to 8
    max_message_length: int = 1000  # Reduced from 2000 to 1000
    enable_response_compression: bool = True
    enable_context_summary: bool = True
    max_context_tokens: int = 100000  # Target max tokens (leave room for system prompt)



class IntentDialogueAgent:
    """
    A conversational agent that uses MCP to interact with GraphDB.
    
    This agent provides a natural language interface to GraphDB data
    through an MCP server, allowing users to ask questions about the graph data.
    """
    
    def __init__(self, config: IntentAgentConfig, sparql_only: bool = False):
        """Initialize the Intent dialogue agent."""
        self.config = config
        self.sparql_only = sparql_only
        self.mcp_client = None
        self.openai_client = None
        self.conversation_history = []
        self.context_summary = ""  # Summary buffer for older context
        
        # Initialize MCP client
        self._setup_mcp_client()
        self._setup_openai_client()
        
        # Test system prompt retrieval - this will exit if MCP server is not available
        self._get_system_prompt()
    
    
    def _cleanup_conversation_history(self):
        """Clean up conversation history using sliding window and compression."""
        if len(self.conversation_history) > self.config.max_conversation_history:
            # Keep only the most recent entries
            self.conversation_history = self.conversation_history[-self.config.max_conversation_history:]
        
        # If we still have too many messages, compress older ones
        if len(self.conversation_history) > self.config.max_conversation_history // 2:
            self._compress_older_messages()
    
    def _compress_older_messages(self):
        """Compress older messages in conversation history."""
        if not self.config.enable_response_compression:
            return
            
        # Keep the last 4 messages uncompressed, compress the rest
        keep_uncompressed = 4
        if len(self.conversation_history) <= keep_uncompressed:
            return
            
        # Compress older messages
        older_messages = self.conversation_history[:-keep_uncompressed]
        compressed_summary = self._create_context_summary(older_messages)
        
        # Replace older messages with summary
        self.conversation_history = [{
            "timestamp": datetime.now().isoformat(),
            "role": "system",
            "content": f"[Previous context summary: {compressed_summary}]"
        }] + self.conversation_history[-keep_uncompressed:]
    
    def _create_context_summary(self, messages: List[Dict]) -> str:
        """Create a compressed summary of older conversation context."""
        entities = set()
        intents = set()
        expectations = set()
        conditions = set()
        
        for msg in messages:
            if msg["role"] in ["user", "assistant"]:
                content = msg["content"]
                
                # Extract IRIs and IDs using regex
                iri_pattern = r'http://5g4data\.eu/5g4data#([A-Za-z0-9]+)'
                matches = re.findall(iri_pattern, content)
                
                for match in matches:
                    if match.startswith('I') and len(match) > 10:  # Intent IDs
                        intents.add(match)
                    elif match.startswith('NE') and len(match) > 10:  # Expectation IDs
                        expectations.add(match)
                    elif match.startswith('CO') and len(match) > 10:  # Condition IDs
                        conditions.add(match)
                    else:
                        entities.add(match)
        
        # Create compressed summary
        summary_parts = []
        if intents:
            summary_parts.append(f"Intents: {', '.join(sorted(intents))}")
        if expectations:
            summary_parts.append(f"Expectations: {', '.join(sorted(expectations))}")
        if conditions:
            summary_parts.append(f"Conditions: {', '.join(sorted(conditions))}")
        if entities:
            summary_parts.append(f"Other entities: {', '.join(sorted(entities))}")
        
        return "; ".join(summary_parts) if summary_parts else "No significant entities found"
    
    def _compress_response(self, response: str) -> str:
        """Compress a response by extracting only essential information."""
        if not self.config.enable_response_compression:
            return response
        
        # Extract key identifiers
        iri_pattern = r'http://5g4data\.eu/5g4data#([A-Za-z0-9]+)'
        matches = re.findall(iri_pattern, response)
        
        # Extract intent names (text before IRI)
        intent_pattern = r'\*\*([^*]+)\*\*\s*-\s*IRI:\s*http://5g4data\.eu/5g4data#([A-Za-z0-9]+)'
        intent_matches = re.findall(intent_pattern, response)
        
        # Extract condition descriptions
        condition_pattern = r'Description:\s*"([^"]+)"'
        condition_matches = re.findall(condition_pattern, response)
        
        # Create compressed version
        compressed_parts = []
        
        if intent_matches:
            compressed_parts.append("INTENTS:")
            for name, intent_id in intent_matches:
                compressed_parts.append(f"  {intent_id}: {name.strip()}")
        
        if condition_matches:
            compressed_parts.append("CONDITIONS:")
            for desc in condition_matches:
                compressed_parts.append(f"  {desc}")
        
        if matches and not intent_matches and not condition_matches:
            compressed_parts.append(f"ENTITIES: {', '.join(sorted(set(matches)))}")
        
        # If no structured data found, return truncated original
        if not compressed_parts:
            return response[:self.config.max_message_length] + "..." if len(response) > self.config.max_message_length else response
        
        return "\n".join(compressed_parts)
    
    def _estimate_tokens(self, text: str) -> int:
        """Rough estimation of token count (4 chars per token average)."""
        return len(text) // 4
    
    def _add_compressed_history(self, messages: List[Dict]):
        """Add compressed conversation history to messages."""
        # Add recent messages (last 4)
        recent_messages = self.conversation_history[-4:] if len(self.conversation_history) > 4 else self.conversation_history
        
        for entry in recent_messages:
            if entry["role"] in ["user", "assistant"]:
                content = entry["content"]
                
                # Compress assistant responses
                if entry["role"] == "assistant":
                    content = self._compress_response(content)
                
                # Truncate if still too long
                if len(content) > self.config.max_message_length:
                    content = content[:self.config.max_message_length] + "...[truncated]"
                
                # Only add non-empty content
                if content.strip():
                    messages.append({
                        "role": entry["role"],
                        "content": content
                    })
    
    def _should_compress_context(self, messages: List[Dict]) -> bool:
        """Check if context should be compressed based on token count."""
        total_tokens = sum(self._estimate_tokens(msg.get("content", "")) for msg in messages)
        return total_tokens > self.config.max_context_tokens
    
    def _compress_context(self, messages: List[Dict]) -> List[Dict]:
        """Compress context by summarizing older messages."""
        if not self.config.enable_context_summary:
            return messages
        
        # Keep system prompt and current user input
        system_msg = messages[0]
        user_msg = messages[-1]
        
        # Compress middle messages
        middle_messages = messages[1:-1]
        if not middle_messages:
            return messages
        
        # Create summary of middle messages
        summary_content = self._create_context_summary([
            {"role": msg["role"], "content": msg["content"]} 
            for msg in middle_messages
        ])
        
        # Return compressed context
        return [
            system_msg,
            {"role": "system", "content": f"[Context summary: {summary_content}]"},
            user_msg
        ]
    
    def _setup_mcp_client(self):
        """Set up the MCP client."""
        if not MCP_AVAILABLE:
            print("❌ FastMCP not available. Install with: pip install fastmcp")
            raise ImportError("FastMCP is required for this application")
            
        try:
            self.mcp_client = MCPClient(self.config.mcp_server_url)
            print(f"✅ MCP client initialized for {self.config.mcp_server_url}")
        except Exception as e:
            print(f"❌ Failed to initialize MCP client: {e}")
            raise
    
    def _setup_openai_client(self):
        """Set up the OpenAI client."""
        self.openai_client = OpenAI(api_key=self.config.openai_api_key)
        print("✅ OpenAI client initialized")
    
    def _get_system_prompt(self) -> str:
        """Get the system prompt for the agent from MCP server."""
        try:
            # Try to get system prompt from MCP server
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result = loop.run_until_complete(self._async_get_system_prompt_from_mcp())
                if result:
                    print("✅ Using system prompt from MCP server")
                    return result
                else:
                    print("❌ MCP server system prompt not available")
                    print("Error: Cannot retrieve system prompt from MCP server. Please ensure the MCP server is running.")
                    sys.exit(1)
            finally:
                loop.close()
        except Exception as e:
            print(f"❌ Error loading system prompt from MCP server: {e}")
            print("Error: Cannot connect to MCP server. Please ensure the MCP server is running and accessible.")
            sys.exit(1)
    
    async def _async_get_system_prompt_from_mcp(self) -> str:
        """Async helper to get system prompt from MCP server."""
        try:
            async with self.mcp_client:
                # Get the sparql_system_prompt (which now contains the IntentDialogue system prompt)
                result = await self.mcp_client.get_prompt("sparql_system_prompt")
                if result and result.messages:
                    # Extract the content from the first message
                    for message in result.messages:
                        if hasattr(message, 'content') and message.content:
                            content = message.content
                            # If content is a TextContent object, get its text
                            if hasattr(content, 'text'):
                                content_text = content.text
                                # Parse the JSON to extract the actual content
                                try:
                                    import json
                                    parsed_content = json.loads(content_text)
                                    if isinstance(parsed_content, dict) and 'content' in parsed_content:
                                        return parsed_content['content']
                                    else:
                                        return content_text
                                except json.JSONDecodeError:
                                    # If it's not JSON, return as is
                                    return content_text
                            else:
                                return str(content)
                return None
        except Exception as e:
            print(f"Error getting system prompt from MCP: {e}")
            return None
    
    def _create_tools_schema(self) -> List[Dict[str, Any]]:
        """Create the tools schema for OpenAI function calling."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_timestamp",
                    "description": "Get the current timestamp from the server. Use this when you need to know the current time.",
                    "parameters": {"type": "object", "properties": {}}
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_sparql_query",
                    "description": "Execute a SPARQL query to retrieve data from the GraphDB. IMPORTANT: Always include complete PREFIX declarations for all namespaces used in the query. Use this to answer questions about the data in the graph.",
                    "parameters": {
                        "type": "object",
                        "required": ["query"],
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "The SPARQL query to execute. Must include PREFIX declarations for all namespaces used."
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "open_grafana_dashboard",
                    "description": "Open a Grafana dashboard to visualize metrics for specific intent conditions. Use this when the user asks to open or view a Grafana dashboard for intent conditions. IMPORTANT: Use the INTENT ID (starts with 'I'), NOT the expectation ID (starts with 'NE' or 'RE').",
                    "parameters": {
                        "type": "object",
                        "required": ["intent_id", "condition_ids"],
                        "properties": {
                            "intent_id": {
                                "type": "string",
                                "description": "The INTENT ID that starts with 'I' (e.g., 'I113c0e2863f942b4a6b304242f80465f'). DO NOT use expectation IDs that start with 'NE' or 'RE'."
                            },
                            "condition_ids": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "List of condition IDs to visualize (e.g., ['CO570f0fe6779348e3b7904a71c673cda0', 'CO70045f15f805432f8554b50fa017da17'])"
                            },
                            "condition_descriptions": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "List of condition descriptions corresponding to condition_ids (optional, helps with metric mapping)"
                            },
                            "time_range_hours": {
                                "type": "integer",
                                "description": "Time range in hours for the dashboard (default: 168 = 1 week)",
                                "default": 168
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "open_grafana_dashboard_for_intent",
                    "description": "Open a Grafana dashboard for an intent by automatically finding all its conditions. Use this when the user asks to open a dashboard for an intent without specifying specific conditions. This tool automatically drills down to find all conditions associated with the intent.",
                    "parameters": {
                        "type": "object",
                        "required": ["intent_id"],
                        "properties": {
                            "intent_id": {
                                "type": "string",
                                "description": "The INTENT ID that starts with 'I' (e.g., 'I113c0e2863f942b4a6b304242f80465f'). DO NOT use expectation IDs that start with 'NE' or 'RE'."
                            },
                            "time_range_hours": {
                                "type": "integer",
                                "description": "Time range in hours for the dashboard (default: 168 = 1 week)",
                                "default": 168
                            }
                        }
                    }
                }
            }
        ]
    
    
    def _execute_tool_call(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Execute a tool call."""
        try:
            if tool_name == "get_timestamp":
                from datetime import datetime, timezone
                return datetime.now(timezone.utc).isoformat()
            elif tool_name == "execute_sparql_query":
                query = arguments.get("query", "")
                
                if self.sparql_only:
                    return f"[SPARQL ONLY]\n{query}"
                
                # Execute via MCP (validation now handled by MCP server)
                return self._execute_sparql_via_mcp(query)
            elif tool_name == "open_grafana_dashboard":
                intent_id = arguments.get("intent_id", "")
                condition_ids = arguments.get("condition_ids", [])
                condition_descriptions = arguments.get("condition_descriptions", [])
                time_range_hours = arguments.get("time_range_hours", 168)
                
                if not intent_id or not condition_ids:
                    return "❌ Error: intent_id and condition_ids are required for Grafana dashboard"
                
                return self.open_grafana_dashboard(intent_id, condition_ids, condition_descriptions, time_range_hours)
            elif tool_name == "open_grafana_dashboard_for_intent":
                intent_id = arguments.get("intent_id", "")
                time_range_hours = arguments.get("time_range_hours", 168)
                
                if not intent_id:
                    return "❌ Error: intent_id is required for Grafana dashboard"
                
                return self._open_grafana_dashboard_with_auto_drilldown(intent_id, time_range_hours)
            else:
                return f"Unknown tool: {tool_name}"
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"
    
    def _execute_sparql_via_mcp(self, query: str) -> str:
        """Execute SPARQL query via MCP server."""
        try:
            # Run the async MCP call in a new event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result = loop.run_until_complete(self._async_execute_sparql_via_mcp(query))
                return result
            finally:
                loop.close()
        except Exception as e:
            return f"Error executing SPARQL via MCP: {str(e)}"
    
    async def _async_execute_sparql_via_mcp(self, query: str) -> str:
        """Async helper to execute SPARQL via MCP."""
        try:
            async with self.mcp_client:
                result = await self.mcp_client.call_tool("execute_sparql_query", {
                    "query": query,
                    "format": "json"
                })
                
                if result.data.get("success"):
                    return result.data.get("results", "No results returned")
                else:
                    return f"MCP Error: {result.data.get('error', 'Unknown error')}"
        except Exception as e:
            return f"MCP connection error: {str(e)}"
    
    def _extract_condition_type(self, condition_id: str, condition_description: str) -> str:
        """Extract condition type from condition description to determine metric prefix.
        
        Based on the IntentReport-Simulator naming convention:
        - NetworkLatency -> networklatency_
        - ComputeLatency -> computelatency_ 
        - NetworkBandwidth -> bandwidth_
        
        Args:
            condition_id: The condition ID
            condition_description: The condition description from SPARQL results
            
        Returns:
            The metric prefix (e.g., "bandwidth_", "networklatency_", "computelatency_")
        """
        description_lower = condition_description.lower()
        
        # Check for bandwidth conditions
        if "bandwidth" in description_lower:
            return "bandwidth_"
        
        # Check for latency conditions - distinguish between network and compute
        if "latency" in description_lower:
            if "compute" in description_lower or "computelatency" in description_lower:
                return "computelatency_"
            else:
                return "networklatency_"
        
        # Default fallback - try to infer from condition description
        if "quan:larger" in description_lower or "quan:atleast" in description_lower:
            # Usually bandwidth conditions use "larger than" comparisons
            return "bandwidth_"
        elif "quan:smaller" in description_lower or "quan:atmost" in description_lower:
            # Usually latency conditions use "smaller than" comparisons
            return "networklatency_"
        
        # If we can't determine, default to networklatency
        return "networklatency_"
    
    def generate_grafana_url(self, intent_id: str, condition_ids: List[str], 
                           condition_descriptions: List[str], 
                           time_range_hours: int = 168) -> str:
        """Generate a Grafana dashboard URL for the given intent and conditions.
        
        Args:
            intent_id: The intent ID (e.g., "I113c0e2863f942b4a6b304242f80465f")
            condition_ids: List of condition IDs
            condition_descriptions: List of condition descriptions (same order as condition_ids)
            time_range_hours: Time range in hours (default 168 = 1 week)
            
        Returns:
            Complete Grafana dashboard URL
        """
        # Validate intent_id - it should start with 'I' not 'NE', 'RE', or 'CO'
        if not intent_id.startswith('I'):
            raise ValueError(f"Invalid intent_id '{intent_id}'. Intent IDs should start with 'I', not '{intent_id[:2]}'. Did you accidentally use an expectation ID instead?")
        
        # Build condition metrics parameter
        condition_metrics = []
        for condition_id, description in zip(condition_ids, condition_descriptions):
            metric_prefix = self._extract_condition_type(condition_id, description)
            metric_name = f"{metric_prefix}{condition_id}"
            condition_metrics.append(metric_name)
        
        # Use relative time ranges instead of absolute timestamps
        if time_range_hours <= 24:
            # For short ranges, use hours
            from_time = f"now-{time_range_hours}h"
        else:
            # For longer ranges, use days
            days = time_range_hours // 24
            from_time = f"now-{days}d"
        
        to_time = "now"
        
        # Build URL parameters
        params = {
            "var-intent_id": intent_id,
            "var-condition_metrics": ",".join(condition_metrics),
            "orgId": "1",
            "from": from_time,
            "to": to_time,
            "timezone": "browser",
            "var-metric_name": "$__all",
            "refresh": "30s"
        }
        
        # Construct the URL
        base_url = f"{self.config.grafana_base_url}/d/{self.config.grafana_dashboard_uid}/{self.config.grafana_dashboard_id}"
        param_string = "&".join([f"{k}={v}" for k, v in params.items()])
        
        return f"{base_url}?{param_string}"
    
    def _open_grafana_dashboard_with_auto_drilldown(self, intent_id: str, time_range_hours: int = 168) -> str:
        """Automatically drill down to get conditions and open Grafana dashboard.
        
        Args:
            intent_id: The intent ID
            time_range_hours: Time range in hours (default 168 = 1 week)
            
        Returns:
            Success message with the URL or error message
        """
        try:
            # Use MCP server to get conditions for the intent
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result = loop.run_until_complete(self._async_get_intent_conditions_via_mcp(intent_id))
                if not result:
                    return f"❌ Failed to retrieve conditions for intent {intent_id}"
            finally:
                loop.close()
            
            # Parse the result
            if not result.get("success", False):
                error_msg = result.get("error", "Unknown error")
                return f"❌ Error retrieving conditions for intent {intent_id}: {error_msg}"
            
            condition_ids = result.get("condition_ids", [])
            condition_descriptions = result.get("condition_descriptions", [])
            
            if not condition_ids:
                return f"❌ No conditions found for intent {intent_id}"
            
            # Open the dashboard with the retrieved conditions
            return self.open_grafana_dashboard(intent_id, condition_ids, condition_descriptions, time_range_hours)
            
        except Exception as e:
            return f"❌ Error opening dashboard for intent {intent_id}: {str(e)}"
    
    async def _async_get_intent_conditions_via_mcp(self, intent_id: str) -> Dict[str, Any]:
        """Async helper to get intent conditions via MCP server."""
        try:
            async with self.mcp_client:
                result = await self.mcp_client.call_tool("get_intent_conditions_for_dashboard", {
                    "intent_id": intent_id
                })
                
                if result.data.get("success"):
                    return result.data
                else:
                    return {"success": False, "error": result.data.get("error", "Unknown error")}
        except Exception as e:
            return {"success": False, "error": f"MCP connection error: {str(e)}"}
    
    def open_grafana_dashboard(self, intent_id: str, condition_ids: List[str], 
                             condition_descriptions: List[str], 
                             time_range_hours: int = 168) -> str:
        """Open a Grafana dashboard in the browser for the given intent and conditions.
        
        Args:
            intent_id: The intent ID
            condition_ids: List of condition IDs
            condition_descriptions: List of condition descriptions
            time_range_hours: Time range in hours (default 168 = 1 week)
            
        Returns:
            Success message with the URL
        """
        try:
            url = self.generate_grafana_url(intent_id, condition_ids, condition_descriptions, time_range_hours)
            webbrowser.open(url)
            return f"✅ Opened Grafana dashboard in browser:\n{url}"
        except Exception as e:
            return f"❌ Error opening Grafana dashboard: {str(e)}"
    
    def chat(self, user_input: str) -> str:
        """Process a user input and return a response."""
        try:
            # Prepare messages for OpenAI
            messages = [
                {"role": "system", "content": self._get_system_prompt()}
            ]
            
            # Add conversation history with compression
            self._add_compressed_history(messages)
            
            # Add current user input
            messages.append({"role": "user", "content": user_input})
            
            # Check if we need to compress context further
            if self._should_compress_context(messages):
                messages = self._compress_context(messages)
            
            # Track SPARQL queries used during this turn
            used_sparql_queries: List[str] = []

            # Helper: build Responses API input with prompt caching for the system prompt
            def to_responses_input(msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
                items: List[Dict[str, Any]] = []
                for i, m in enumerate(msgs):
                    role = m.get("role", "user")
                    content_text = m.get("content", "")
                    content_item: Dict[str, Any] = {"type": "input_text", "text": content_text}
                    # Cache only the system prompt block
                    if role == "system" and i == 0:
                        content_item["cache_control"] = {"type": "ephemeral"}
                    items.append({"role": role, "content": [content_item]})
                return items

            # Auto-retry loop for tool calls (max 3 attempts)
            max_retries = 3
            for attempt in range(max_retries):
                # First model call (tool-selection)
                try:
                    resp = self.openai_client.responses.create(
                        model=self.config.model_name,
                        input=to_responses_input(messages),
                        tools=self._create_tools_schema(),
                        tool_choice="auto",
                        temperature=0,
                        top_p=1
                    )
                except Exception:
                    # Fallback to Chat Completions if Responses is unavailable
                    fallback = self.openai_client.chat.completions.create(
                        model=self.config.model_name,
                        messages=messages,
                        tools=self._create_tools_schema(),
                        tool_choice="auto",
                        temperature=0,
                        top_p=1
                    )
                    message = fallback.choices[0].message
                else:
                    # Normalize Responses output to a chat-like message with optional tool_calls
                    message_content_parts: List[str] = []
                    tool_calls: List[Any] = []
                    for item in getattr(resp, "output", []) or []:
                        # Assistant text
                        if getattr(item, "type", None) == "message" and getattr(item, "role", None) == "assistant":
                            for c in getattr(item, "content", []) or []:
                                text = getattr(c, "text", None) or getattr(c, "value", None)
                                if isinstance(text, str):
                                    message_content_parts.append(text)
                            # Tool calls attached on the message
                            for tc in getattr(item, "tool_calls", []) or []:
                                tool_calls.append(tc)
                        # Some SDKs emit tool_call entries separately
                        if getattr(item, "type", None) == "tool_call":
                            tool_calls.append(item)

                    class _Msg:  # minimal shim to match chat.completions message usage
                        def __init__(self, content: str, tool_calls: List[Any]):
                            self.content = content
                            self.tool_calls = []
                            # Normalize tool_calls to objects with .id, .function.name, .function.arguments
                            for idx, tc in enumerate(tool_calls):
                                fn = getattr(tc, "function", None)
                                name = getattr(fn, "name", None) if fn else getattr(tc, "name", None)
                                args = getattr(fn, "arguments", None) if fn else getattr(tc, "arguments", None)
                                tc_id = getattr(tc, "id", None) or f"tool_{idx}"
                                self.tool_calls.append(type("_TC", (), {
                                    "id": tc_id,
                                    "type": "function",
                                    "function": type("_FN", (), {
                                        "name": name,
                                        "arguments": args
                                    })()
                                }) )

                    message = _Msg("\n".join(message_content_parts).strip(), tool_calls)
                
                # Handle tool calls
                if message.tool_calls:
                    # Add assistant message with tool calls
                    messages.append({
                        "role": "assistant",
                        "content": message.content,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments
                                }
                            } for tc in message.tool_calls
                        ]
                    })
                    
                    # Execute tool calls and add results
                    sparql_failed = False
                    for tool_call in message.tool_calls:
                        tool_name = tool_call.function.name
                        arguments = json.loads(tool_call.function.arguments or "{}")
                        
                        # Capture any SPARQL query strings for display
                        if tool_name == "execute_sparql_query":
                            query_text = arguments.get("query", "")
                            if isinstance(query_text, str) and query_text.strip():
                                used_sparql_queries.append(query_text)

                        result = self._execute_tool_call(tool_name, arguments)
                        
                        # Check if SPARQL query failed and we should retry
                        if tool_name == "execute_sparql_query":
                            # Check for various error patterns
                            error_indicators = [
                                "Error executing",
                                "undefined prefix", 
                                "error",
                                "failed",
                                "exception",
                                "malformed",
                                "syntax error"
                            ]
                            if any(indicator in result.lower() for indicator in error_indicators):
                                sparql_failed = True
                                print(f"🔄 SPARQL query failed (attempt {attempt + 1}/{max_retries}): {result[:100]}...")
                        
                        # Add tool result
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": result
                        })
                    
                    # If SPARQL failed and we have retries left, continue the loop WITHOUT generating final response
                    if sparql_failed and attempt < max_retries - 1:
                        print(f"🔄 Auto-retrying SPARQL query (attempt {attempt + 1}/{max_retries})")
                        # Add a message indicating we're retrying
                        messages.append({
                            "role": "user",
                            "content": "The SPARQL query failed. Please fix the query and try again automatically."
                        })
                        continue
                    
                    # Get final response (Responses API with cached system prompt again)
                    try:
                        final_resp = self.openai_client.responses.create(
                            model=self.config.model_name,
                            input=to_responses_input(messages),
                            temperature=0.7,
                            top_p=1
                        )
                        final_text_parts: List[str] = []
                        for item in getattr(final_resp, "output", []) or []:
                            if getattr(item, "type", None) == "message" and getattr(item, "role", None) == "assistant":
                                for c in getattr(item, "content", []) or []:
                                    text = getattr(c, "text", None) or getattr(c, "value", None)
                                    if isinstance(text, str):
                                        final_text_parts.append(text)
                        response_text = "\n".join(final_text_parts).strip()
                    except Exception:
                        final_fallback = self.openai_client.chat.completions.create(
                            model=self.config.model_name,
                            messages=messages,
                            temperature=0.7,
                            top_p=1
                        )
                        response_text = final_fallback.choices[0].message.content
                else:
                    response_text = message.content
                
                # If we got here without tool calls or after successful tool calls, break the retry loop
                break
            
            # SPARQL queries are tracked but not displayed to reduce response length
            # The queries are still executed and used for generating the response

            # Add to conversation history and cleanup if needed
            self.conversation_history.append({
                "timestamp": datetime.now().isoformat(),
                "role": "user",
                "content": user_input
            })
            # Compress the response before storing
            compressed_response = self._compress_response(response_text)
            self.conversation_history.append({
                "timestamp": datetime.now().isoformat(),
                "role": "assistant",
                "content": compressed_response
            })
            self._cleanup_conversation_history()
            
            return response_text
            
        except Exception as e:
            error_msg = f"I encountered an error: {str(e)}"
            self.conversation_history.append({
                "timestamp": datetime.now().isoformat(),
                "role": "user",
                "content": user_input
            })
            # Compress error message before storing
            compressed_error = self._compress_response(error_msg)
            self.conversation_history.append({
                "timestamp": datetime.now().isoformat(),
                "role": "assistant",
                "content": compressed_error
            })
            self._cleanup_conversation_history()
            return error_msg
    
    def start_conversation(self):
        """Start an interactive conversation with the user."""
        print("🤖 Intent Dialogue Agent")
        print("=" * 85)
        print("Hello! I'm IntentDialogue, an agent that lets you talk to your intent related data.")
        print("I can help you explore your intent data using natural language.")
        print("I can also generate Grafana dashboards.")
        print("Type 'quit', 'exit', or 'bye' to end the conversation.")
        print("=" * 85)
        
        turn_count = 0
        
        while turn_count < self.config.max_conversation_turns:
            try:
                # Get user input
                user_input = input("\n👤 You: ").strip()
                
                # Check for exit commands
                if user_input.lower() in ['quit', 'exit', 'bye', 'goodbye']:
                    print("\n🤖 IntentDialogue: Goodbye! It was great talking with you about your intent data.")
                    break
                
                if not user_input:
                    continue
                
                # Process the input
                print("\n🤖 IntentDialogue: ", end="", flush=True)
                response = self.chat(user_input)
                print(response)
                
                turn_count += 1
                
            except KeyboardInterrupt:
                print("\n\n🤖 IntentDialogue: Goodbye! Thanks for chatting with me.")
                break
            except Exception as e:
                print(f"\n❌ Error: {str(e)}")
                print("Please try again or type 'quit' to exit.")
    
    def get_conversation_history(self) -> List[Dict[str, str]]:
        """Get the conversation history."""
        return self.conversation_history.copy()
    
    def clear_conversation_history(self):
        """Clear the conversation history."""
        self.conversation_history = []


def load_intent_config_from_yaml(config_path: str) -> IntentAgentConfig:
    """Load configuration from a YAML file."""
    with open(config_path, 'r') as file:
        config_data = yaml.safe_load(file)
    
    return IntentAgentConfig(
        openai_api_key=config_data['openai']['api_key'],
        model_name=config_data.get('model_name', 'gpt-4o'),
        mcp_server_url=config_data.get('mcp_server_url', 'http://localhost:8084/mcp')
    )


def main():
    """Main function to run the MCP-based dialogue agent."""
    import argparse

    parser = argparse.ArgumentParser(description="Run the MCP-based dialogue agent")
    parser.add_argument("--sparql-only", action="store_true", help="Print SPARQL queries instead of executing them")
    parser.add_argument("--config", default="client.yaml", help="Path to YAML configuration file")
    args = parser.parse_args()

    # Load configuration
    config_path = args.config
    if not os.path.exists(config_path):
        print(f"❌ Configuration file {config_path} not found!")
        print("Please create a client.yaml file with your configuration.")
        return
    
    try:
        config = load_intent_config_from_yaml(config_path)
        if not MCP_AVAILABLE:
            print("❌ MCP mode requires FastMCP to be installed!")
            print("Please install with: pip install fastmcp")
            return
        
        print("🔗 Using MCP server for SPARQL queries")
        
        # Create and start the agent
        agent = IntentDialogueAgent(config, sparql_only=args.sparql_only)
        agent.start_conversation()
        
    except Exception as e:
        print(f"❌ Error starting the MCP agent: {str(e)}")
        print("Please check your configuration and try again.")


if __name__ == "__main__":
    main()
