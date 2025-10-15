"""Template management tools for Intent Generation MCP Server using intent-generator-package."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Union, Annotated

from fastmcp import FastMCP
from pydantic import BaseModel, Field
from intent_generator import (
    IntentGenerator,
    NetworkIntentParams,
    WorkloadIntentParams,
    CombinedIntentParams,
    IntentType,
)

# Configure logging
logger = logging.getLogger(__name__)


class NetworkSlots(BaseModel):
    latency: Optional[Annotated[float, Field(description="One-way latency target", gt=0, json_schema_extra={"units": "ms"})]] = Field(default=None)
    latency_operator: Optional[Annotated[str, Field(description="Quantifier for latency (e.g., smaller, larger, inRange)")]] = Field(default=None)
    latency_end: Optional[Annotated[float, Field(description="Latency range end when latency_operator is inRange", gt=0, json_schema_extra={"units": "ms"})]] = Field(default=None)
    bandwidth: Optional[Annotated[float, Field(description="Throughput target", gt=0, json_schema_extra={"units": "Mbps"})]] = Field(default=None)
    bandwidth_operator: Optional[Annotated[str, Field(description="Quantifier for bandwidth (e.g., larger, smaller, inRange)")]] = Field(default=None)
    bandwidth_end: Optional[Annotated[float, Field(description="Bandwidth range end when bandwidth_operator is inRange", gt=0, json_schema_extra={"units": "Mbps"})]] = Field(default=None)
    location: Optional[Annotated[str, Field(description="Human-readable area name used to derive location details if provided")]] = Field(default=None)
    description: Optional[Annotated[str, Field(description="Free-text description of the intent")]] = Field(default=None)
    handler: Optional[Annotated[str, Field(description="System responsible for handling the intent")]] = Field(default=None)
    owner: Optional[Annotated[str, Field(description="Organization owning the intent")]] = Field(default=None)
    customer: Optional[Annotated[str, Field(description="Customer identifier, typically MSISDN")]] = Field(default=None)


class WorkloadSlots(BaseModel):
    compute_latency: Optional[Annotated[float, Field(description="End-to-end application compute latency target", gt=0, json_schema_extra={"units": "ms"})]] = Field(default=None)
    compute_latency_operator: Optional[Annotated[str, Field(description="Quantifier for compute latency (smaller, larger, inRange)")]] = Field(default=None)
    compute_latency_end: Optional[Annotated[float, Field(description="Compute latency range end when operator is inRange", gt=0, json_schema_extra={"units": "ms"})]] = Field(default=None)
    datacenter: Optional[Annotated[str, Field(description="Target edge/cloud datacenter identifier")]] = Field(default=None)
    application: Optional[Annotated[str, Field(description="Application name to be deployed")]] = Field(default=None)
    descriptor: Optional[Annotated[str, Field(description="URL to deployment descriptor (e.g., Helm/K8s YAML)")]] = Field(default=None)
    description: Optional[Annotated[str, Field(description="Free-text description of the workload intent")]] = Field(default=None)
    handler: Optional[Annotated[str, Field(description="System responsible for handling the intent")]] = Field(default=None)
    owner: Optional[Annotated[str, Field(description="Organization owning the intent")]] = Field(default=None)
    customer: Optional[Annotated[str, Field(description="Customer identifier, typically MSISDN")]] = Field(default=None)


class CombinedSlots(NetworkSlots, WorkloadSlots):
    pass


def register_generation_tools(mcp: FastMCP) -> None:
    """Register intent generation tools using intent-generator-package."""
    
    # Initialize the intent generator
    generator = IntentGenerator()
    
    @mcp.tool
    def generate_intent(
        intent_type: Annotated[str, Field(description="Type of intent", examples=["network", "workload", "combined"])],
        slots: Annotated[Dict[str, Any], Field(description="Parameters for intent generation. See intent-specific slot schemas below:")],
    ) -> Dict[str, Any]:
        """Generate an intent using the intent-generator-package.

        - intent_type: one of "network", "workload", "combined".
        - slots (network):
          - latency (float, ms): One-way latency target; gt 0
          - latency_operator (str): smaller|larger|inRange|...; quantifier for latency
          - latency_end (float, ms): End of range for inRange
          - bandwidth (float, Mbps): Throughput target; gt 0
          - bandwidth_operator (str): larger|smaller|inRange|...
          - bandwidth_end (float, Mbps): End of range for inRange
          - location (str): Area name
          - description (str): Free text
          - handler (str): Handling system
          - owner (str): Owning organization
          - customer (str): Customer identifier (e.g., MSISDN)
        - slots (workload):
          - compute_latency (float, ms): Application compute latency target; gt 0
          - compute_latency_operator (str): smaller|larger|inRange|...
          - compute_latency_end (float, ms): End of range for inRange
          - datacenter (str): Target edge/cloud site
          - application (str): Application name
          - descriptor (str): URL to deployment descriptor
          - description, handler, owner, customer: As above
        - slots (combined): union of network and workload slots

        Returns: Generated intent as TTL string.
        """
        try:
            # Convert intent_type to IntentType enum
            try:
                intent_type_enum = IntentType(intent_type.lower())
                logger.debug("Generated intent type: %s", intent_type_enum)
            except ValueError:
                logger.warning("Unknown intent type: %s", intent_type)
                return {
                    "error": f"Unknown intent type: {intent_type}",
                    "available_types": [t.value for t in IntentType],
                    "intent_type": intent_type,
                    "slots": slots
                }
            
            # Create appropriate parameter object based on intent type
            if intent_type_enum == IntentType.NETWORK:
                params = NetworkIntentParams(**slots)
                generated_intent = generator.generate_network_intent(params)
                logger.info("Generated network intent with %d slots", len(slots))
            elif intent_type_enum == IntentType.WORKLOAD:
                params = WorkloadIntentParams(**slots)
                generated_intent = generator.generate_workload_intent(params)
                logger.info("Generated workload intent with %d slots", len(slots))
            elif intent_type_enum == IntentType.COMBINED:
                params = CombinedIntentParams(**slots)
                generated_intent = generator.generate_combined_intent(params)
                logger.info("Generated combined intent with %d slots", len(slots))
            else:
                logger.error("Unsupported intent type: %s", intent_type)
                return {
                    "error": f"Unsupported intent type: {intent_type}",
                    "intent_type": intent_type,
                    "slots": slots
                }
            
            logger.debug("Generated intent length: %d characters", len(generated_intent))
            return {
                "intent_type": intent_type,
                "slots": slots,
                "generated_intent": generated_intent,
                "status": "success"
            }
            
        except Exception as e:
            logger.exception("Error generating intent: %s", e)
            return {
                "error": str(e),
                "intent_type": intent_type,
                "slots": slots
            }
    
    @mcp.tool
    def generate_network_intent(
        slots: Annotated[NetworkSlots | Dict[str, Any], Field(description="Network intent parameters. Fields and units: \n- latency (float, ms)\n- latency_operator (str)\n- latency_end (float, ms)\n- bandwidth (float, Mbps)\n- bandwidth_operator (str)\n- bandwidth_end (float, Mbps)\n- location (str)\n- description (str)\n- handler (str)\n- owner (str)\n- customer (str)")]
    ) -> Dict[str, Any]:
        """Generate a network intent with provided parameters.

        Slots schema (units): see parameter description above.
        """
        try:
            slots_dict = slots.model_dump() if isinstance(slots, BaseModel) else slots
            logger.debug("Generating network intent with slots: %s", slots_dict)
            
            # Provide default operators if missing
            if slots_dict.get("latency") and not slots_dict.get("latency_operator"):
                slots_dict["latency_operator"] = "smaller"
                logger.info("Added default latency_operator: smaller")
            if slots_dict.get("bandwidth") and not slots_dict.get("bandwidth_operator"):
                slots_dict["bandwidth_operator"] = "larger"
                logger.info("Added default bandwidth_operator: larger")
            
            params = NetworkIntentParams(**slots_dict)
            generated_intent = generator.generate_network_intent(params)
            logger.info("Successfully generated network intent")
            
            return {
                "intent_type": "network",
                "slots": slots_dict,
                "generated_intent": generated_intent,
                "status": "success"
            }
        except Exception as e:
            logger.exception("Error generating network intent: %s", e)
            return {
                "error": str(e),
                "intent_type": "network",
                "slots": slots if isinstance(slots, dict) else slots.model_dump()
            }
    
    @mcp.tool
    def generate_workload_intent(
        slots: Annotated[WorkloadSlots | Dict[str, Any], Field(description="Workload intent parameters. Fields and units: \n- compute_latency (float, ms)\n- compute_latency_operator (str)\n- compute_latency_end (float, ms)\n- datacenter (str)\n- application (str)\n- descriptor (str, URL)\n- description (str)\n- handler (str)\n- owner (str)\n- customer (str)")]
    ) -> Dict[str, Any]:
        """Generate a workload intent with provided parameters.

        Slots schema (units): see parameter description above.
        """
        try:
            slots_dict = slots.model_dump() if isinstance(slots, BaseModel) else slots
            logger.debug("Generating workload intent with slots: %s", slots_dict)
            
            # Provide default operators if missing
            if slots_dict.get("compute_latency") and not slots_dict.get("compute_latency_operator"):
                slots_dict["compute_latency_operator"] = "smaller"
                logger.info("Added default compute_latency_operator: smaller")
            
            params = WorkloadIntentParams(**slots_dict)
            generated_intent = generator.generate_workload_intent(params)
            logger.info("Successfully generated workload intent")
            
            return {
                "intent_type": "workload",
                "slots": slots_dict,
                "generated_intent": generated_intent,
                "status": "success"
            }
        except Exception as e:
            logger.exception("Error generating workload intent: %s", e)
            return {
                "error": str(e),
                "intent_type": "workload",
                "slots": slots if isinstance(slots, dict) else slots.model_dump()
            }
    
    @mcp.tool
    def generate_combined_intent(
        slots: Annotated[CombinedSlots | Dict[str, Any], Field(description="Combined intent parameters (union of network and workload). Fields and units: see network and workload slot descriptions above.")]
    ) -> Dict[str, Any]:
        """Generate a combined network and workload intent with provided parameters.

        Slots schema (units): union of network and workload parameters.
        """
        try:
            slots_dict = slots.model_dump() if isinstance(slots, BaseModel) else slots
            logger.debug("Generating combined intent with slots: %s", slots_dict)
            
            # Provide default operators if missing
            if slots_dict.get("latency") and not slots_dict.get("latency_operator"):
                slots_dict["latency_operator"] = "smaller"
                logger.info("Added default latency_operator: smaller")
            if slots_dict.get("bandwidth") and not slots_dict.get("bandwidth_operator"):
                slots_dict["bandwidth_operator"] = "larger"
                logger.info("Added default bandwidth_operator: larger")
            if slots_dict.get("compute_latency") and not slots_dict.get("compute_latency_operator"):
                slots_dict["compute_latency_operator"] = "smaller"
                logger.info("Added default compute_latency_operator: smaller")
            
            params = CombinedIntentParams(**slots_dict)
            generated_intent = generator.generate_combined_intent(params)
            logger.info("Successfully generated combined intent")
            
            return {
                "intent_type": "combined",
                "slots": slots_dict,
                "generated_intent": generated_intent,
                "status": "success"
            }
        except Exception as e:
            logger.exception("Error generating combined intent: %s", e)
            return {
                "error": str(e),
                "intent_type": "combined",
                "slots": slots if isinstance(slots, dict) else slots.model_dump()
            }
    
    @mcp.tool
    def list_intent_types() -> Dict[str, Any]:
        """List all available intent types."""
        return {
            "intent_types": [
                {
                    "type": "network",
                    "description": "Network slice configuration intent with QoS guarantees",
                    "parameters": {
                        "latency": "float (default: 20.0)",
                        "latency_operator": "str (default: 'smaller')",
                        "latency_end": "float (optional, for inRange)",
                        "bandwidth": "float (default: 300.0)",
                        "bandwidth_operator": "str (default: 'larger')",
                        "bandwidth_end": "float (optional, for inRange)",
                        "location": "str (default, 'Tromsø')",
                        "description": "str (optional)",
                        "handler": "str (optional)",
                        "owner": "str (optional)",
                        "customer": "str (default: '+47 90914547')"
                    }
                },
                {
                    "type": "workload",
                    "description": "Workload deployment intent for cloud-native applications",
                    "parameters": {
                        "compute_latency": "float (default: 20.0)",
                        "compute_latency_operator": "str (default: 'smaller')",
                        "compute_latency_end": "float (optional, for inRange)",
                        "datacenter": "str (default: 'EC1')",
                        "application": "str (default: 'AR-retail-app')",
                        "descriptor": "str (default: 'http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml')",
                        "description": "str (optional)",
                        "handler": "str (optional)",
                        "owner": "str (optional)",
                        "customer": "str (default: '+47 90914547')"
                    }
                },
                {
                    "type": "combined",
                    "description": "Combined network and workload intent",
                    "parameters": {
                        "latency": "float (default: 20.0)",
                        "latency_operator": "str (default: 'smaller')",
                        "latency_end": "float (optional, for inRange)",
                        "bandwidth": "float (default: 300.0)",
                        "bandwidth_operator": "str (default: 'larger')",
                        "bandwidth_end": "float (optional, for inRange)",
                        "location": "str (default, 'Tromsø')",
                        "description": "str (optional)",
                        "compute_latency": "float (default: 20.0)",
                        "compute_latency_operator": "str (default: 'smaller')",
                        "compute_latency_end": "float (optional, for inRange)",
                        "datacenter": "str (default: 'EC1')",
                        "application": "str (default: 'AR-retail-app')",
                        "descriptor": "str (default: 'http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml')",
                        "description": "str (optional)",
                        "handler": "str (optional)",
                        "owner": "str (optional)",
                        "customer": "str (default: '+47 90914547')"
                    }
                }
            ]
        }
    
    @mcp.tool
    def get_intent_schema(intent_type: str) -> Dict[str, Any]:
        """Get the schema for a specific intent type."""
        try:
            intent_type_enum = IntentType(intent_type.lower())
            
            schemas = {
                IntentType.NETWORK: {
                    "type": "network",
                    "description": "Network slice configuration intent with QoS guarantees",
                    "required_fields": [],
                    "optional_fields": [
                        "latency", "latency_operator", "latency_end",
                        "bandwidth", "bandwidth_operator", "bandwidth_end",
                        "location", "description", "handler", "owner", "customer"
                    ],
                    "field_types": {
                        "latency": "float",
                        "latency_operator": "str",
                        "latency_end": "float",
                        "bandwidth": "float",
                        "bandwidth_operator": "str",
                        "bandwidth_end": "float",
                        "location": "str",
                        "description": "str",
                        "handler": "str",
                        "owner": "str",
                        "customer": "str"
                    },
                    "defaults": {
                        "latency": 20.0,
                        "latency_operator": "smaller",
                        "bandwidth": 300.0,
                        "bandwidth_operator": "larger",
                        "customer": "+47 90914547"
                    }
                },
                IntentType.WORKLOAD: {
                    "type": "workload",
                    "description": "Workload deployment intent for cloud-native applications",
                    "required_fields": [],
                    "optional_fields": [
                        "compute_latency", "compute_latency_operator", "compute_latency_end",
                        "datacenter", "application", "descriptor",
                        "description", "handler", "owner", "customer"
                    ],
                    "field_types": {
                        "compute_latency": "float",
                        "compute_latency_operator": "str",
                        "compute_latency_end": "float",
                        "datacenter": "str",
                        "application": "str",
                        "descriptor": "str",
                        "description": "str",
                        "handler": "str",
                        "owner": "str",
                        "customer": "str"
                    },
                    "defaults": {
                        "compute_latency": 20.0,
                        "compute_latency_operator": "smaller",
                        "datacenter": "EC1",
                        "application": "AR-retail-app",
                        "descriptor": "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml",
                        "customer": "+47 90914547"
                    }
                },
                IntentType.COMBINED: {
                    "type": "combined",
                    "description": "Combined network and workload intent",
                    "required_fields": [],
                    "optional_fields": [
                        "latency", "latency_operator", "latency_end",
                        "bandwidth", "bandwidth_operator", "bandwidth_end",
                        "location",
                        "compute_latency", "compute_latency_operator", "compute_latency_end",
                        "datacenter", "application", "descriptor",
                        "description", "handler", "owner", "customer"
                    ],
                    "field_types": {
                        "latency": "float",
                        "latency_operator": "str",
                        "latency_end": "float",
                        "bandwidth": "float",
                        "bandwidth_operator": "str",
                        "bandwidth_end": "float",
                        "location": "str",
                        "compute_latency": "float",
                        "compute_latency_operator": "str",
                        "compute_latency_end": "float",
                        "datacenter": "str",
                        "application": "str",
                        "descriptor": "str",
                        "description": "str",
                        "handler": "str",
                        "owner": "str",
                        "customer": "str"
                    },
                    "defaults": {
                        "latency": 20.0,
                        "latency_operator": "smaller",
                        "bandwidth": 300.0,
                        "bandwidth_operator": "larger",
                        "compute_latency": 20.0,
                        "compute_latency_operator": "smaller",
                        "datacenter": "EC1",
                        "application": "AR-retail-app",
                        "descriptor": "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml",
                        "customer": "+47 90914547"
                    }
                }
            }
            
            return schemas[intent_type_enum]
            
        except ValueError:
            return {
                "error": f"Unknown intent type: {intent_type}",
                "available_types": [t.value for t in IntentType]
            }
    
    @mcp.tool
    def validate_intent_slots(intent_type: str, slots: Dict[str, Any]) -> Dict[str, Any]:
        """Validate intent slots against expected schema."""
        try:
            intent_type_enum = IntentType(intent_type.lower())
            
            # Get schema for validation
            schema = get_intent_schema(intent_type)
            if "error" in schema:
                return schema
            
            # Basic validation - check if all provided fields are valid
            valid_fields = set(schema["optional_fields"])
            provided_fields = set(slots.keys())
            invalid_fields = provided_fields - valid_fields
            
            if invalid_fields:
                return {
                    "valid": False,
                    "errors": [f"Invalid field: {field}" for field in invalid_fields],
                    "intent_type": intent_type,
                    "slots": slots,
                    "valid_fields": list(valid_fields)
                }
            
            return {
                "valid": True,
                "intent_type": intent_type,
                "slots": slots,
                "note": "Basic validation passed; all provided fields are valid"
            }
            
        except ValueError:
            return {
                "valid": False,
                "errors": [f"Unknown intent type: {intent_type}"],
                "available_types": [t.value for t in IntentType]
            }
    
    @mcp.tool
    def generate_tmf921_payload(intent: Dict[str, Any]) -> Dict[str, Any]:
        """Generate TMF921 API payload from intent."""
        return {
            "api": "TMF921",
            "version": "1.1.0",
            "payload": {
                "intentType": intent.get("intent_type", "unknown"),
                "intentContent": intent.get("generated_intent", ""),
                "metadata": {
                    "generatedBy": "Intent Generation MCP Server",
                    "generator": "intent-generator-package",
                    "timestamp": "2024-01-01T00:00:00Z"
                }
            },
            "note": "Generated TMF921 payload; validate against actual TMF921 schema"
        }

    @mcp.prompt(name="5g4data_system_prompt")
    def intent_generation_initial_prompt() -> List[Dict[str, str]]:
        """System prompt used to initiate business-to-service intent scoping dialogues."""
        prompt = (
            "You are an expert Intent Designer for telecom and edge-cloud services. "
            "Hold a concise, professional conversation to translate a user's business-level goal into "
            "service-level intents that this MCP server can generate: network, workload, or a combination.\n\n"
            "Your objectives:\n"
            "1) Understand the user's business outcome (what experience is needed, where, and for whom).\n"
            "2) Decide which service intent(s) apply: 'network', 'workload', or 'combined'.\n"
            "3) Extract or confirm the minimal slot values required by that intent type.\n\n"
            "Supported slots (names and units):\n"
            "- Network: latency (ms), latency_operator, latency_end (ms), bandwidth (Mbps), bandwidth_operator, "
            "bandwidth_end (Mbps), location (name), description, handler, owner, customer.\n"
            "- Workload: compute_latency (ms), compute_latency_operator, compute_latency_end (ms), datacenter, application, "
            "descriptor (URL), description, handler, owner, customer.\n"
            "- Combined: union of Network and Workload slots.\n\n"
            "Operator choices typically include: smaller, larger, inRange (with *_end provided for ranges).\n\n"
            "Guidance:\n"
            "- If the user mentions connectivity/QoS (latency, bandwidth, area), prioritize a Network intent.\n"
            "- If the user mentions deploying/placing applications or datacenters, prioritize a Workload intent.\n"
            "- If both apply, choose Combined.\n"
            "- Keep questions minimal and targeted; ask only for missing inputs.\n"
            "- If location is vague, ask for an area name (location).\n"
            "- Use ranges (inRange + *_end) when the user states bounds.\n\n"
            "Tools available via this MCP server:\n"
            "- list_intent_types\n"
            "- get_intent_schema(intent_type)\n"
            "- validate_intent_slots(intent_type, slots)\n"
            "- generate_network_intent(slots), generate_workload_intent(slots), generate_combined_intent(slots)\n\n"
            "Conversation output expectations:\n"
            "- State the chosen intent_type (network|workload|combined) and why.\n"
            "- Present a compact JSON object named 'slots' with the values you have and placeholders for any missing critical ones.\n"
            "- If unsure between types, briefly compare and ask one clarifying question.\n\n"
            "Example summary before calling a generation tool:\n"
            "intent_type: network\n"
            "slots: {\n"
            "  \"latency\": 20, \"latency_operator\": \"smaller\",\n"
            "  \"bandwidth\": 300, \"bandwidth_operator\": \"larger\",\n"
            "  \"location\": \"Downtown Tromsø\"\n"
            "}\n"
        )
        return [{"role": "system", "content": prompt}]

    @mcp.prompt(name="5g4data_welcome")
    def five_g4data_welcome_prompt() -> List[Dict[str, str]]:
        """5G4Data welcome prompt for starting conversations."""
        content = (
            "Hi! I'm the 5G4Data Intent Assistant. I help translate your business needs into "
            "formal TM Forum service-level intents for 5G networks and edge computing.\n\n"
            "I can help you create three types of intents:\n"
            "• **Network Intents**: For connectivity, latency, and bandwidth requirements\n"
            "• **Workload Intents**: For deploying applications to specific datacenters\n"
            "• **Combined Intents**: For both network and workload requirements together\n\n"
            "Just tell me what you need - for example:\n"
            "• 'I need low latency for video calls in downtown Oslo'\n"
            "• 'Deploy my AR app to edge datacenters with <20ms latency'\n"
            "• 'I need high bandwidth for data transfer in the Arctic region'\n\n"
            "I'll ask clarifying questions and generate the appropriate intent for you!"
        )
        return [{"role": "assistant", "content": content}]

    @mcp.tool
    def analyze_application(
        application_name: Annotated[str, Field(description="Name of the application to analyze")],
        context: Annotated[Optional[str], Field(description="Additional context about the application")] = None
    ) -> Dict[str, Any]:
        """Analyze an application to determine typical network and workload requirements.
        
        This tool provides intelligent defaults based on common application patterns.
        """
        # Common application patterns and their requirements
        app_patterns = {
            "video": {"latency": 50, "bandwidth": 10, "needs_edge": False, "datacenter": "EC2"},
            "video_call": {"latency": 30, "bandwidth": 5, "needs_edge": True, "datacenter": "EC1"},
            "ar": {"latency": 15, "bandwidth": 20, "needs_edge": True, "datacenter": "EC1"},
            "vr": {"latency": 20, "bandwidth": 50, "needs_edge": True, "datacenter": "EC1"},
            "gaming": {"latency": 25, "bandwidth": 15, "needs_edge": True, "datacenter": "EC1"},
            "iot": {"latency": 100, "bandwidth": 1, "needs_edge": False, "datacenter": "EC3"},
            "streaming": {"latency": 100, "bandwidth": 25, "needs_edge": False, "datacenter": "EC2"},
            "web": {"latency": 200, "bandwidth": 5, "needs_edge": False, "datacenter": "EC3"},
            "mobile": {"latency": 50, "bandwidth": 10, "needs_edge": False, "datacenter": "EC2"},
            "retail": {"latency": 30, "bandwidth": 15, "needs_edge": True, "datacenter": "EC1"},
        }
        
        app_lower = application_name.lower()
        matched_pattern = None
        
        # Find best matching pattern
        for pattern, requirements in app_patterns.items():
            if pattern in app_lower:
                matched_pattern = pattern
                break
        
        if matched_pattern:
            requirements = app_patterns[matched_pattern]
            return {
                "application": application_name,
                "matched_pattern": matched_pattern,
                "recommended_latency": requirements["latency"],
                "recommended_bandwidth": requirements["bandwidth"],
                "needs_edge_deployment": requirements["needs_edge"],
                "recommended_datacenter": requirements["datacenter"],
                "intent_type_suggestion": "combined" if requirements["needs_edge"] else "network",
                "confidence": "high"
            }
        else:
            # Default recommendations for unknown applications
            return {
                "application": application_name,
                "matched_pattern": None,
                "recommended_latency": 50,
                "recommended_bandwidth": 10,
                "needs_edge_deployment": False,
                "recommended_datacenter": "EC2",
                "intent_type_suggestion": "network",
                "confidence": "low",
                "note": "Unknown application type - using conservative defaults"
            }

    @mcp.tool
    def analyze_conversation(
        messages: Annotated[List[Dict[str, str]], Field(description="Conversation messages to analyze")],
        current_intent_type: Annotated[Optional[str], Field(description="Current intent type if known")] = None
    ) -> Dict[str, Any]:
        """Analyze conversation messages to extract intent parameters and determine completeness.
        
        This tool helps identify what information is available and what's still missing.
        """
        # Extract text content from messages
        conversation_text = " ".join([
            f"{msg.get('role', 'unknown')}: {msg.get('content', '')}" 
            for msg in messages
        ]).lower()
        
        # Keywords for different intent types
        network_keywords = ["latency", "bandwidth", "speed", "connection", "network", "qos", "throughput"]
        workload_keywords = ["deploy", "application", "app", "datacenter", "edge", "cloud", "compute"]
        location_keywords = ["oslo", "tromsø", "arctic", "nordic", "norway", "location", "area", "region"]
        
        # Analyze intent type
        network_score = sum(1 for keyword in network_keywords if keyword in conversation_text)
        workload_score = sum(1 for keyword in workload_keywords if keyword in conversation_text)
        
        if workload_score > network_score:
            suggested_intent_type = "workload"
        elif network_score > workload_score:
            suggested_intent_type = "network"
        else:
            suggested_intent_type = "combined"
        
        # Extract potential values using simple patterns
        extracted_slots = {}
        
        # Look for latency mentions
        import re
        latency_match = re.search(r'(\d+)\s*ms', conversation_text)
        if latency_match:
            extracted_slots["latency"] = float(latency_match.group(1))
        
        # Look for bandwidth mentions
        bandwidth_match = re.search(r'(\d+)\s*(mbps|mb/s|mbit)', conversation_text)
        if bandwidth_match:
            extracted_slots["bandwidth"] = float(bandwidth_match.group(1))
        
        # Look for application mentions
        app_match = re.search(r'(app|application|service)\s*[:\-]?\s*([a-zA-Z0-9\-_]+)', conversation_text)
        if app_match:
            extracted_slots["application"] = app_match.group(2)
        
        # Look for location mentions
        for location in ["oslo", "tromsø", "arctic", "nordic", "norway"]:
            if location in conversation_text:
                extracted_slots["location"] = location.title()
                break
        
        # Determine missing slots based on intent type
        missing_slots = []
        if suggested_intent_type in ["network", "combined"]:
            if not extracted_slots.get("latency"):
                missing_slots.append("latency")
            if not extracted_slots.get("bandwidth"):
                missing_slots.append("bandwidth")
        
        if suggested_intent_type in ["workload", "combined"]:
            if not extracted_slots.get("application"):
                missing_slots.append("application")
            if not extracted_slots.get("datacenter"):
                missing_slots.append("datacenter")
        
        return {
            "suggested_intent_type": suggested_intent_type,
            "extracted_slots": extracted_slots,
            "missing_slots": missing_slots,
            "conversation_complete": len(missing_slots) == 0,
            "confidence": "high" if len(extracted_slots) > 2 else "medium"
        }

    @mcp.tool
    def health_check() -> Dict[str, Any]:
        """Health check endpoint for monitoring server status."""
        try:
            # Test intent generator
            generator = IntentGenerator()
            test_params = NetworkIntentParams(latency=20.0, bandwidth=100.0)
            test_intent = generator.generate_network_intent(test_params)
            
            return {
                "status": "healthy",
                "timestamp": "2024-01-01T00:00:00Z",
                "services": {
                    "intent_generator": "operational",
                    "mcp_server": "operational"
                },
                "test_intent_generated": len(test_intent) > 0
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "timestamp": "2024-01-01T00:00:00Z",
                "error": str(e),
                "services": {
                    "intent_generator": "error",
                    "mcp_server": "operational"
                }
            }
