from __future__ import annotations

import logging
from typing import Optional

import requests
from inserv.services.turtle_parser import TurtleParser


class IntentRouter:
    """Service to route intents to the appropriate handler (inOrch-TMF-Proxy or inNet)."""

    def __init__(self, infrastructure_service, test_mode: bool = False, innet_base_url: str = "http://intend.eu/inNet", innet_ready: bool = True, graphdb_client=None):
        self._infrastructure_service = infrastructure_service
        self._logger = logging.getLogger(self.__class__.__name__)
        self._test_mode = test_mode
        self._innet_base_url = innet_base_url.rstrip("/")
        self._innet_ready = innet_ready
        self._graphdb_client = graphdb_client
        self._turtle_parser = TurtleParser()

    def route_intent(
        self, intent_data: dict, datacenter: str
    ) -> tuple[dict | None, int, dict]:
        """
        Route an intent to the appropriate handler(s) based on expectations.
        
        - NetworkExpectation only → route to inNet
        - DeploymentExpectation only → route to inOrch-TMF-Proxy
        - Both NE and DE → split and route to both handlers, return bundle
        
        Args:
            intent_data: The intent data to forward (as dictionary)
            datacenter: DataCenter identifier (e.g., "EC21")
            
        Returns:
            Tuple of (response_data, status_code, headers)
            Returns (None, error_code, {}) on error
        """
        # Extract turtle expression
        turtle_expr = None
        try:
            expression = intent_data.get("expression") if isinstance(intent_data, dict) else None
            if isinstance(expression, dict):
                turtle_expr = expression.get("expressionValue") or expression.get("value")
        except Exception:
            turtle_expr = None
        
        if not turtle_expr:
            self._logger.warning("No turtle expression found in intent, falling back to inOrch routing")
            return self._route_to_inorch(intent_data, datacenter)
        
        # Detect expectations
        ne, de, re_list = self._turtle_parser.find_all_expectations(turtle_expr)
        
        # Determine routing strategy
        has_ne = ne is not None
        has_de = de is not None
        
        # Log what was detected
        if has_ne and has_de:
            self._logger.info("Parsing: Detected both network (NE) and deployment (DE) expectations")
        elif has_ne:
            self._logger.info("Parsing: Detected network (NE) expectation only")
        elif has_de:
            self._logger.info("Parsing: Detected deployment (DE) expectation only")
        else:
            self._logger.info("Parsing: No expectations detected, using fallback routing")
        
        # In test mode we do not forward intents, we only log them.
        if self._test_mode:
            handlers = []
            if has_ne and has_de:
                handlers = ["inNet", "inOrch"]
                # Try to split and log both
                try:
                    ne_turtle, de_turtle = self._turtle_parser.split_turtle_intent(turtle_expr)
                    self._logger.info(
                        "Test mode enabled - received intent for DataCenter %s with both NE and DE. "
                        "Would split and forward to: %s. NE intent:\n%s\nDE intent:\n%s",
                        datacenter,
                        ", ".join(handlers),
                        ne_turtle,
                        de_turtle,
                    )
                except Exception as exc:
                    self._logger.warning(
                        "Test mode: Failed to split intent, but would forward to: %s. Error: %s",
                        ", ".join(handlers),
                        exc
                    )
            elif has_ne:
                handlers = ["inNet"]
                self._logger.info(
                    "Test mode enabled - received intent for DataCenter %s with NetworkExpectation only. "
                    "Would forward to: inNet. Turtle expression:\n%s",
                    datacenter,
                    turtle_expr,
                )
            elif has_de:
                handlers = ["inOrch"]
                self._logger.info(
                    "Test mode enabled - received intent for DataCenter %s with DeploymentExpectation only. "
                    "Would forward to: inOrch. Turtle expression:\n%s",
                    datacenter,
                    turtle_expr,
                )
            else:
                handlers = ["inOrch (fallback)"]
                self._logger.info(
                    "Test mode enabled - received intent for DataCenter %s with no expectations detected. "
                    "Would forward to: inOrch (fallback). Payload: %s",
                    datacenter,
                    intent_data,
                )
            
            # Return test response (bundle if split)
            if has_ne and has_de:
                response_data = {
                    "@type": "Intent",
                    "isBundle": True,
                    "description": f"Test mode: Intent would be split and forwarded to {', '.join(handlers)}"
                }
            else:
                response_data: dict | None = dict(intent_data) if isinstance(intent_data, dict) else None
            headers: dict = {}
            return response_data, 200, headers
        
        # Route based on expectations
        if has_ne and has_de:
            # Both present: split and route to both
            return self._split_and_route(intent_data, datacenter, turtle_expr)
        elif has_ne:
            # Only NE: route to inNet
            return self._route_to_innet(intent_data, turtle_expr)
        elif has_de:
            # Only DE: route to inOrch
            return self._route_to_inorch(intent_data, datacenter)
        else:
            # No expectations detected: fallback to inOrch
            self._logger.warning("No expectations detected, falling back to inOrch routing")
            return self._route_to_inorch(intent_data, datacenter)

    def _route_to_inorch(
        self, intent_data: dict, datacenter: str
    ) -> tuple[dict | None, int, dict]:
        """Route intent to inOrch-TMF-Proxy (existing behavior)."""
        # Get the target URL for this DataCenter (required from GraphDB, no fallback)
        try:
            target_url = self._infrastructure_service.get_datacenter_url(datacenter)
        except RuntimeError as exc:
            self._logger.error(
                "Failed to get DataCenter URL for %s: %s",
                datacenter,
                exc,
            )
            return (
                {
                    "code": "503",
                    "reason": f"GraphDB unavailable: {str(exc)}",
                    "message": "Cannot route intent - GraphDB is not responding",
                },
                503,
                {},
            )
        
        if not target_url:
            self._logger.error(
                "Could not determine URL for DataCenter: %s",
                datacenter,
            )
            return (
                {
                    "code": "500",
                    "reason": f"DataCenter {datacenter} not found in GraphDB",
                    "message": "DataCenter not found in infrastructure data",
                },
                500,
                {},
            )
        
        # Ensure URL ends with the intent endpoint
        if not target_url.endswith("/intent"):
            if target_url.endswith("/"):
                target_url = f"{target_url}intent"
            else:
                target_url = f"{target_url}/intent"
        
        self._logger.info(
            "Routing: Sending DE intent to inOrch (DataCenter %s) at %s",
            datacenter,
            target_url,
        )
        
        return self._send_request(target_url, intent_data, datacenter, "inOrch")
    
    def _route_to_innet(
        self, intent_data: dict, turtle_expr: str
    ) -> tuple[dict | None, int, dict]:
        """Route intent to inNet."""
        target_url = f"{self._innet_base_url}/intent"
        
        self._logger.info(
            "Routing: Sending NE intent to inNet at %s",
            target_url,
        )
        
        # If inNet is not ready, inServ handles on behalf of inNet (store intent in GraphDB)
        if not self._innet_ready:
            # Store the turtle expression in GraphDB
            intent_id = self._store_intent_in_graphdb(turtle_expr)
            if intent_id:
                self._logger.info(
                    "Routing: Successfully sent to inNet - status 200"
                )
                # Store a StateIntentReceived status report
                self._store_intent_received_report(intent_id)
            else:
                self._logger.warning(
                    "Routing: Failed to send to inNet"
                )
            # Return success response
            return (
                {
                    "@type": "Intent",
                    "id": intent_id,
                    "description": "Intent accepted by inNet",
                },
                200,
                {},
            )
        
        return self._send_request(target_url, intent_data, None, "inNet")
    
    def _store_intent_in_graphdb(self, turtle_data: str) -> Optional[str]:
        """Store intent turtle data in GraphDB and return the intent ID."""
        import re
        
        if not self._graphdb_client:
            self._logger.warning("GraphDB client not available, cannot store intent")
            return None
        
        try:
            # Store the turtle data directly (repository should already exist)
            headers = {
                'Content-Type': 'application/x-turtle'
            }
            sparql_endpoint = f"{self._graphdb_client.base_url}/repositories/{self._graphdb_client.repository}/statements"
            
            response = requests.post(
                sparql_endpoint,
                data=turtle_data.encode('utf-8'),
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            
            # Extract intent ID from the turtle data
            # The intent ID is in the form "I<uuid>" or "data5g:I<uuid>"
            match = re.search(r'data5g:I([a-f0-9-]+)', turtle_data)
            if match:
                return match.group(1)
            
            # Try another pattern
            match = re.search(r'#I([a-f0-9-]+)', turtle_data)
            if match:
                return match.group(1)
            
            return None
            
        except Exception as exc:
            self._logger.error("Failed to store intent in GraphDB: %s", exc, exc_info=True)
            return None
    
    def _store_intent_received_report(self, intent_id: str) -> bool:
        """Store a StateIntentReceived status report in GraphDB for the given intent."""
        import uuid
        from datetime import datetime, timezone
        
        if not self._graphdb_client:
            self._logger.warning("GraphDB client not available, cannot store intent report")
            return False
        
        try:
            report_id = str(uuid.uuid4())
            current_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            
            # Generate turtle for the intent report
            # Using full URIs to avoid prefix issues
            icm_ns = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/"
            data5g_ns = "http://5g4data.eu/5g4data#"
            xsd_ns = "http://www.w3.org/2001/XMLSchema#"
            imo_ns = "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/"
            
            turtle_report = f'<{icm_ns}RP{report_id}> a <{icm_ns}IntentReport> ;'
            turtle_report += f' <{icm_ns}about> <{data5g_ns}I{intent_id}> ;'
            turtle_report += f' <{icm_ns}reportNumber> "1"^^<{xsd_ns}integer> ;'
            turtle_report += f' <{icm_ns}reportGenerated> "{current_time}"^^<{xsd_ns}dateTime>'
            turtle_report += f' ; <{imo_ns}handler> "inNet"'
            turtle_report += f' ; <{imo_ns}owner> "inServ"'
            turtle_report += f' ; <{icm_ns}intentHandlingState> <{imo_ns}StateIntentReceived>'
            turtle_report += f' ; <{icm_ns}reason> "Intent received and being processed"'
            turtle_report += ' .'
            
            # Store the report in GraphDB
            headers = {
                'Content-Type': 'application/x-turtle'
            }
            sparql_endpoint = f"{self._graphdb_client.base_url}/repositories/{self._graphdb_client.repository}/statements"
            
            response = requests.post(
                sparql_endpoint,
                data=turtle_report.encode('utf-8'),
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            
            self._logger.debug(
                "Stored StateIntentReceived report for intent ID: %s",
                intent_id
            )
            return True
            
        except Exception as exc:
            self._logger.error("Failed to store intent report in GraphDB: %s", exc, exc_info=True)
            return False
    
    def _split_and_route(
        self, intent_data: dict, datacenter: str, turtle_expr: str
    ) -> tuple[dict | None, int, dict]:
        """Split intent and route to both inNet and inOrch, return bundle response."""
        try:
            # Store the original combined intent in GraphDB for provenance
            original_intent_id = self._store_intent_in_graphdb(turtle_expr)
            if original_intent_id:
                self._logger.info(
                    "Storage: Stored original combined intent in GraphDB with ID: %s",
                    original_intent_id
                )
            else:
                self._logger.warning(
                    "Storage: Failed to store original combined intent in GraphDB"
                )
            
            # Split the turtle expression
            ne_turtle, de_turtle = self._turtle_parser.split_turtle_intent(turtle_expr)
            
            # Create intent data for NE version
            ne_intent_data = dict(intent_data)
            if "expression" in ne_intent_data and isinstance(ne_intent_data["expression"], dict):
                ne_intent_data["expression"] = dict(ne_intent_data["expression"])
                ne_intent_data["expression"]["expressionValue"] = ne_turtle
            
            # Create intent data for DE version
            de_intent_data = dict(intent_data)
            if "expression" in de_intent_data and isinstance(de_intent_data["expression"], dict):
                de_intent_data["expression"] = dict(de_intent_data["expression"])
                de_intent_data["expression"]["expressionValue"] = de_turtle
            
            self._logger.debug(
                "Splitting intent: routing NE to inNet and DE to inOrch (DataCenter %s)",
                datacenter
            )
            
            # Route to both handlers
            ne_response, ne_status, ne_headers = self._route_to_innet(ne_intent_data, ne_turtle)
            de_response, de_status, de_headers = self._route_to_inorch(de_intent_data, datacenter)
            
            # Create bundle response
            bundle_response = {
                "@type": "Intent",
                "isBundle": True,
                "description": "Intent split and routed to inNet and inOrch",
                "intents": []
            }
            
            # Add responses to bundle
            if ne_response:
                ne_intent = dict(ne_response)
                ne_intent["@type"] = ne_intent.get("@type", "Intent")
                bundle_response["intents"].append(ne_intent)
            
            if de_response:
                de_intent = dict(de_response)
                de_intent["@type"] = de_intent.get("@type", "Intent")
                bundle_response["intents"].append(de_intent)
            
            # Determine overall status code (use worst status)
            overall_status = max(ne_status, de_status) if ne_status and de_status else (ne_status or de_status or 500)
            
            # Merge headers (prefer inOrch headers)
            combined_headers = dict(ne_headers)
            combined_headers.update(de_headers)
            
            self._logger.info(
                "Status: Split routing complete - inNet: %d, inOrch: %d",
                ne_status,
                de_status
            )
            
            return bundle_response, overall_status, combined_headers
            
        except ValueError as exc:
            self._logger.error("Failed to split intent: %s", exc)
            return (
                {
                    "code": "400",
                    "reason": f"Cannot split intent: {str(exc)}",
                },
                400,
                {},
            )
        except Exception as exc:
            self._logger.error("Error during split routing: %s", exc, exc_info=True)
            return (
                {
                    "code": "500",
                    "reason": f"Internal error during split routing: {str(exc)}",
                },
                500,
                {},
            )
    
    def _send_request(
        self, target_url: str, intent_data: dict, datacenter: Optional[str], handler_name: str
    ) -> tuple[dict | None, int, dict]:
        """Send HTTP request to target URL and handle responses."""
        try:
            # Forward the intent to the target
            response = requests.post(
                target_url,
                json=intent_data,
                headers={"Content-Type": "application/json"},
                timeout=30,
            )
            
            # Get response data
            try:
                response_data = response.json() if response.content else None
            except ValueError:
                response_data = {"message": response.text} if response.text else None
            
            # Log the result
            if response.status_code >= 200 and response.status_code < 300:
                self._logger.info(
                    "Routing: Successfully sent to %s - status %d",
                    handler_name,
                    response.status_code,
                )
            else:
                self._logger.warning(
                    "Routing: Failed to send to %s - status %d: %s",
                    handler_name,
                    response.status_code,
                    response_data,
                )
            
            # Return response headers
            headers = dict(response.headers)
            
            return response_data, response.status_code, headers
            
        except requests.exceptions.Timeout:
            dc_info = f" (DataCenter {datacenter})" if datacenter else ""
            self._logger.error(
                "Timeout while routing intent to %s (%s)%s",
                target_url,
                handler_name,
                dc_info,
            )
            return (
                {
                    "code": "504",
                    "reason": f"Timeout connecting to {handler_name}",
                },
                504,
                {},
            )
        except requests.exceptions.ConnectionError as exc:
            dc_info = f" (DataCenter {datacenter})" if datacenter else ""
            self._logger.error(
                "Connection error while routing intent to %s (%s)%s: %s",
                target_url,
                handler_name,
                dc_info,
                exc,
            )
            return (
                {
                    "code": "503",
                    "reason": f"Cannot connect to {handler_name}",
                },
                503,
                {},
            )
        except Exception as exc:
            dc_info = f" (DataCenter {datacenter})" if datacenter else ""
            self._logger.error(
                "Error routing intent to %s (%s)%s: %s",
                target_url,
                handler_name,
                dc_info,
                exc,
                exc_info=True,
            )
            return (
                {
                    "code": "500",
                    "reason": f"Internal error routing to {handler_name}: {str(exc)}",
                },
                500,
                {},
            )
