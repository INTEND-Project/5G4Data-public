"""
GraphDB TTYG REST API Dialogue Agent

A conversational agent that interacts with GraphDB's TTYG REST API endpoint.
This agent calls the TTYG service directly via HTTP requests.
"""

import os
import yaml
import requests
import json
import base64
import asyncio
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from datetime import datetime

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
class TTYGAgentConfig:
    """Configuration for the TTYG REST API agent."""
    openai_api_key: str
    ttyg_base_url: str
    ttyg_agent_id: str
    username: Optional[str] = None
    password: Optional[str] = None
    model_name: str = "gpt-5"
    max_conversation_turns: int = 50
    # GraphDB settings for direct SPARQL calls
    graphdb_url: Optional[str] = None
    graphdb_repository_id: Optional[str] = None
    sparql_only: bool = False
    # MCP server settings
    mcp_server_url: str = "http://localhost:8084/mcp"


class TTYGRestClient:
    """
    Client for interacting with GraphDB's TTYG REST API or direct GraphDB SPARQL endpoint.
    """
    
    def __init__(self, base_url: str, agent_id: str, username: str = None, password: str = None, 
                 use_direct: bool = False, graphdb_url: str = None, repository_id: str = None):
        """Initialize the TTYG REST client."""
        self.base_url = base_url.rstrip('/')
        self.agent_id = agent_id
        self.use_direct = use_direct
        self.auth = None
        
        if username and password:
            self.auth = (username, password)
        
        if use_direct:
            # Direct GraphDB SPARQL endpoint
            self.graphdb_url = graphdb_url or base_url
            self.repository_id = repository_id
            self.endpoint_url = f"{self.graphdb_url}/repositories/{repository_id}"
        else:
            # TTYG agent endpoint
            self.endpoint_url = f"{self.base_url}/rest/llm/tool/ttyg/{agent_id}"
    
    def get_timestamp(self) -> str:
        """Get current timestamp from the TTYG agent."""
        try:
            response = requests.post(
                f"{self.endpoint_url}/now",
                json={},
                auth=self.auth,
                headers={"Content-Type": "application/json"},
                timeout=10
            )
            response.raise_for_status()
            return response.text.strip()
        except Exception as e:
            raise Exception(f"Failed to get timestamp: {str(e)}")
    
    def execute_sparql_query(self, query: str) -> str:
        """Execute a SPARQL query via TTYG agent or direct GraphDB endpoint."""
        try:
            if self.use_direct:
                # Direct GraphDB SPARQL endpoint
                response = requests.post(
                    self.endpoint_url,
                    data={"query": query},
                    auth=self.auth,
                    headers={
                        "Accept": "application/sparql-results+json",
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    timeout=30
                )
                response.raise_for_status()
                
                # Parse JSON response and format as readable text
                try:
                    json_data = response.json()
                    if "results" in json_data and "bindings" in json_data["results"]:
                        bindings = json_data["results"]["bindings"]
                        if not bindings:
                            return "No results found."
                        
                        # Format results as a simple table
                        vars_list = json_data["head"].get("vars", [])
                        if vars_list:
                            # Create header
                            header = " | ".join(vars_list)
                            separator = " | ".join(["-" * len(var) for var in vars_list])
                            result_lines = [header, separator]
                            
                            # Add data rows
                            for binding in bindings:
                                row = []
                                for var in vars_list:
                                    value = binding.get(var, {}).get("value", "")
                                    row.append(value)
                                result_lines.append(" | ".join(row))
                            
                            return "\n".join(result_lines)
                        else:
                            return "Query executed successfully."
                    else:
                        return response.text
                except ValueError:
                    # If not JSON, return raw text
                    return response.text
            else:
                # TTYG agent endpoint
                response = requests.post(
                    f"{self.endpoint_url}/sparql_query",
                    json={"query": query},
                    auth=self.auth,
                    headers={"Content-Type": "application/json"},
                    timeout=30
                )
                response.raise_for_status()
                return response.text.strip()
        except Exception as e:
            raise Exception(f"Failed to execute SPARQL query: {str(e)}")
    
    def get_openapi_spec(self) -> Dict[str, Any]:
        """Get the OpenAPI specification for the TTYG agent."""
        try:
            response = requests.get(
                f"{self.endpoint_url}?format=json",
                auth=self.auth,
                timeout=10
            )
            response.raise_for_status()
            # Parse YAML response
            import yaml
            return yaml.safe_load(response.text)
        except Exception as e:
            raise Exception(f"Failed to get OpenAPI spec: {str(e)}")


class TTYGDialogueAgent:
    """
    A conversational agent that uses GraphDB's TTYG REST API.
    
    This agent provides a natural language interface to your TTYG agent,
    allowing users to ask questions about the graph data.
    """
    
    def __init__(self, config: TTYGAgentConfig, sparql_only: bool = False, use_direct: bool = False, use_mcp: bool = False):
        """Initialize the TTYG dialogue agent."""
        self.config = config
        self.sparql_only = sparql_only
        self.use_direct = use_direct
        self.use_mcp = use_mcp
        self.ttyg_client = None
        self.mcp_client = None
        self.openai_client = None
        self.conversation_history = []
        self.max_conversation_history = 20  # Keep max 20 entries in memory
        
        # Initialize components
        # Only initialize the connection relevant to the chosen mode
        if self.use_mcp:
            # MCP mode: do NOT connect to TTYG agent
            self._setup_mcp_client()
        else:
            # TTYG or direct GraphDB modes initialize the REST client
            self._setup_ttyg_client()
        self._setup_openai_client()
    
    def _setup_ttyg_client(self):
        """Set up the TTYG REST client."""
        if self.use_mcp:
            # In MCP mode we skip initializing/printing TTYG connection info
            return
        try:
            self.ttyg_client = TTYGRestClient(
                base_url=self.config.ttyg_base_url,
                agent_id=self.config.ttyg_agent_id,
                username=self.config.username,
                password=self.config.password,
                use_direct=self.use_direct,
                graphdb_url=self.config.graphdb_url,
                repository_id=self.config.graphdb_repository_id
            )
            
            if self.use_direct:
                print(f"✅ Connected to GraphDB SPARQL endpoint at {self.config.graphdb_url}")
                print(f"📊 Repository: {self.config.graphdb_repository_id}")
            else:
                print(f"✅ Connected to TTYG agent at {self.config.ttyg_base_url}")
                print(f"🤖 Agent ID: {self.config.ttyg_agent_id}")
            
            if self.sparql_only:
                print("🧪 SPARQL-only mode: SPARQL will be shown but not executed")
            
            # Test the connection
            if not self.use_direct:
                timestamp = self.ttyg_client.get_timestamp()
                print(f"🕐 Server time: {timestamp}")
            
        except Exception as e:
            print(f"❌ Failed to connect to {'GraphDB' if self.use_direct else 'TTYG agent'}: {str(e)}")
            raise
    
    def _cleanup_conversation_history(self):
        """Clean up conversation history to prevent it from growing too large."""
        if len(self.conversation_history) > self.max_conversation_history:
            # Keep only the most recent entries
            self.conversation_history = self.conversation_history[-self.max_conversation_history:]
    
    def _setup_mcp_client(self):
        """Set up the MCP client."""
        if not self.use_mcp:
            return
            
        if not MCP_AVAILABLE:
            print("⚠️  Warning: FastMCP not available. Install with: pip install fastmcp")
            print("   Falling back to TTYG client")
            self.use_mcp = False
            return
            
        try:
            self.mcp_client = MCPClient(self.config.mcp_server_url)
            print(f"✅ MCP client initialized for {self.config.mcp_server_url}")
        except Exception as e:
            print(f"⚠️  Warning: Could not initialize MCP client: {e}")
            print("   Falling back to TTYG client")
            self.use_mcp = False
    
    def _setup_openai_client(self):
        """Set up the OpenAI client."""
        self.openai_client = OpenAI(api_key=self.config.openai_api_key)
        print("✅ OpenAI client initialized")
    
    def _get_system_prompt(self) -> str:
        """Get the system prompt for the agent."""
        try:
            with open('system_prompt.txt', 'r', encoding='utf-8') as f:
                system_prompt = f.read().strip()
                # print(f"✅ Using system prompt from system_prompt.txt: {system_prompt[:100]}...")
                return system_prompt
        except FileNotFoundError:
            print("⚠️  system_prompt.txt not found, using fallback system prompt")
            return self._get_fallback_system_prompt()
        except Exception as e:
            print(f"⚠️  Error loading system_prompt.txt: {e}, using fallback system prompt")
            return self._get_fallback_system_prompt()
    
    def _get_fallback_system_prompt(self) -> str:
        """Get the fallback system prompt."""
        system_prompt = """You are 5G4DataTTYG, an intelligent assistant that helps users interact with GraphDB data through natural language.

You have access to a TTYG (Talk to Your Graph) agent that can:
1. Execute SPARQL queries to retrieve data from the graph
2. Get current timestamps

When users ask questions about the data:
- Convert their questions into appropriate SPARQL queries
- Use the available ontology prefixes and classes
- Provide clear, human-readable explanations of the results
- If a query fails, try alternative approaches or explain what went wrong

Always be helpful and provide context about what the data means."""

        print(f"Using fallback system prompt: {system_prompt}")
        return system_prompt
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
                    "description": "Execute a SPARQL query to retrieve data from the GraphDB. Use this to answer questions about the data in the graph.",
                    "parameters": {
                        "type": "object",
                        "required": ["query"],
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "The SPARQL query to execute"
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
                # Prefer local timestamp if TTYG client isn't initialized (e.g., MCP mode)
                try:
                    if self.ttyg_client:
                        return self.ttyg_client.get_timestamp()
                except Exception:
                    pass
                from datetime import datetime, timezone
                return datetime.now(timezone.utc).isoformat()
            elif tool_name == "execute_sparql_query":
                query = arguments.get("query", "")
                if self.sparql_only:
                    return f"[SPARQL ONLY]\n{query}"
                
                # Use MCP if available and enabled
                if self.use_mcp and self.mcp_client:
                    return self._execute_sparql_via_mcp(query)
                else:
                    return self.ttyg_client.execute_sparql_query(query)
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
    
    def chat(self, user_input: str) -> str:
        """Process a user input and return a response."""
        try:
            # Prepare messages for OpenAI
            messages = [
                {"role": "system", "content": self._get_system_prompt()}
            ]
            
            # Add conversation history (only essential parts, max 5 messages)
            max_history_messages = 5
            max_message_length = 2000  # Truncate long messages
            
            for entry in self.conversation_history[-max_history_messages:]:
                if entry["role"] in ["user", "assistant"]:
                    content = entry["content"]
                    
                    # Remove SPARQL query blocks from history to avoid duplication
                    if entry["role"] == "assistant" and "SPARQL used:" in content:
                        # Keep only the response part after SPARQL queries
                        parts = content.split("\n\n", 1)
                        if len(parts) > 1:
                            content = parts[1]  # Keep only the response part
                    
                    # Truncate very long messages
                    if len(content) > max_message_length:
                        content = content[:max_message_length] + "...[truncated]"
                    
                    # Only add non-empty content
                    if content.strip():
                        messages.append({
                            "role": entry["role"],
                            "content": content
                        })
            
            # Add current user input
            messages.append({"role": "user", "content": user_input})
            
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
            
            # Always display the SPARQL queries used (if any) as part of the assistant output
            if used_sparql_queries:
                header = "SPARQL used:\n" + "\n\n".join(
                    [f"{idx+1})\n{q}" for idx, q in enumerate(used_sparql_queries)]
                )
                response_text = f"{header}\n\n{response_text}"

            # Add to conversation history and cleanup if needed
            self.conversation_history.append({
                "timestamp": datetime.now().isoformat(),
                "role": "user",
                "content": user_input
            })
            self.conversation_history.append({
                "timestamp": datetime.now().isoformat(),
                "role": "assistant",
                "content": response_text
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
            self.conversation_history.append({
                "timestamp": datetime.now().isoformat(),
                "role": "assistant",
                "content": error_msg
            })
            self._cleanup_conversation_history()
            return error_msg
    
    def start_conversation(self):
        """Start an interactive conversation with the user."""
        print("🤖 GraphDB TTYG Dialogue Agent")
        print("=" * 75)
        print("Hello! I'm 5G4DataTTYG, your TTYG assistant for Telenor 5G4Data use case.")
        print("I can help you explore your GraphDB data using natural language.")
        print("Type 'quit', 'exit', or 'bye' to end the conversation.")
        print("=" * 75)
        
        turn_count = 0
        
        while turn_count < self.config.max_conversation_turns:
            try:
                # Get user input
                user_input = input("\n👤 You: ").strip()
                
                # Check for exit commands
                if user_input.lower() in ['quit', 'exit', 'bye', 'goodbye']:
                    print("\n🤖 5G4DataTTYG: Goodbye! It was great talking with you about your GraphDB data.")
                    break
                
                if not user_input:
                    continue
                
                # Process the input
                print("\n🤖 5G4DataTTYG: ", end="", flush=True)
                response = self.chat(user_input)
                print(response)
                
                turn_count += 1
                
            except KeyboardInterrupt:
                print("\n\n🤖 5G4DataTTYG: Goodbye! Thanks for chatting with me.")
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


def load_ttyg_config_from_yaml(config_path: str) -> TTYGAgentConfig:
    """Load TTYG configuration from a YAML file."""
    with open(config_path, 'r') as file:
        config_data = yaml.safe_load(file)
    
    return TTYGAgentConfig(
        openai_api_key=config_data['openai']['api_key'],
        ttyg_base_url=config_data['ttyg']['base_url'],
        ttyg_agent_id=config_data['ttyg']['agent_id'],
        username=config_data['ttyg'].get('username'),
        password=config_data['ttyg'].get('password'),
        model_name=config_data.get('model_name', 'gpt-4o'),
        # GraphDB settings for direct calls
        graphdb_url=config_data.get('graphdb', {}).get('url'),
        graphdb_repository_id=config_data.get('graphdb', {}).get('repository_id')
    )


def main():
    """Main function to run the TTYG dialogue agent."""
    import argparse

    parser = argparse.ArgumentParser(description="Run the TTYG dialogue agent")
    parser.add_argument("--sparql-only", action="store_true", help="Print SPARQL queries instead of executing them")
    parser.add_argument("--direct", action="store_true", help="Use direct GraphDB SPARQL endpoint instead of TTYG agent")
    parser.add_argument("--mcp", action="store_true", help="Use MCP server for SPARQL queries instead of TTYG agent")
    parser.add_argument("--config", default="client.yaml", help="Path to YAML configuration file")
    args = parser.parse_args()

    # Load configuration
    config_path = args.config
    if not os.path.exists(config_path):
        print(f"❌ Configuration file {config_path} not found!")
        print("Please create a client.yaml file with your TTYG configuration.")
        return
    
    try:
        config = load_ttyg_config_from_yaml(config_path)
        
        # Validate configuration for direct mode
        if args.direct:
            if not config.graphdb_url or not config.graphdb_repository_id:
                print("❌ Direct mode requires GraphDB URL and repository ID in configuration!")
                print("Please add 'graphdb.url' and 'graphdb.repository_id' to your client.yaml")
                return
        
        if args.mcp:
            if not MCP_AVAILABLE:
                print("❌ MCP mode requires FastMCP to be installed!")
                print("Please install with: pip install fastmcp")
                return
            print("🔗 Using MCP server for SPARQL queries")
            if args.direct:
                print("❌ --mcp and --direct are mutually exclusive")
                return
        
        # Create and start the agent
        agent = TTYGDialogueAgent(config, sparql_only=args.sparql_only, use_direct=args.direct, use_mcp=args.mcp)
        agent.start_conversation()
        
    except Exception as e:
        mode = "MCP" if args.mcp else ("GraphDB" if args.direct else "TTYG")
        print(f"❌ Error starting the {mode} agent: {str(e)}")
        print("Please check your configuration and try again.")


if __name__ == "__main__":
    main()
