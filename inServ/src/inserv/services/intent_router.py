from __future__ import annotations

import logging
from typing import Optional

import requests


class IntentRouter:
    """Service to route intents to the appropriate inOrch-TMF-Proxy instance."""

    def __init__(self, infrastructure_service, test_mode: bool = False):
        self._infrastructure_service = infrastructure_service
        self._logger = logging.getLogger(self.__class__.__name__)
        self._test_mode = test_mode

    def route_intent(
        self, intent_data: dict, datacenter: str
    ) -> tuple[dict | None, int, dict]:
        """
        Route an intent to the appropriate inOrch-TMF-Proxy instance.
        
        Args:
            intent_data: The intent data to forward (as dictionary)
            datacenter: DataCenter identifier (e.g., "EC21")
            
        Returns:
            Tuple of (response_data, status_code, headers)
            Returns (None, error_code, {}) on error
        """
        # In test mode we do not forward intents, we only log them.
        if self._test_mode:
            self._logger.info(
                "Test mode enabled - received intent for DataCenter %s but NOT "
                "forwarding to inOrch-TMF-Proxy. Payload: %s",
                datacenter,
                intent_data,
            )
            response_data: dict | None = dict(intent_data) if isinstance(intent_data, dict) else None
            headers: dict = {}
            return response_data, 200, headers

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
            "Routing intent to DataCenter %s at %s",
            datacenter,
            target_url,
        )
        
        try:
            # Forward the intent to the target proxy
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
                    "Successfully routed intent to %s: status %d",
                    target_url,
                    response.status_code,
                )
            else:
                self._logger.warning(
                    "Intent routing to %s returned status %d: %s",
                    target_url,
                    response.status_code,
                    response_data,
                )
            
            # Return response headers
            headers = dict(response.headers)
            
            return response_data, response.status_code, headers
            
        except requests.exceptions.Timeout:
            self._logger.error(
                "Timeout while routing intent to %s (DataCenter %s)",
                target_url,
                datacenter,
            )
            return (
                {
                    "code": "504",
                    "reason": f"Timeout connecting to DataCenter {datacenter}",
                },
                504,
                {},
            )
        except requests.exceptions.ConnectionError as exc:
            self._logger.error(
                "Connection error while routing intent to %s (DataCenter %s): %s",
                target_url,
                datacenter,
                exc,
            )
            return (
                {
                    "code": "503",
                    "reason": f"Cannot connect to DataCenter {datacenter}",
                },
                503,
                {},
            )
        except Exception as exc:
            self._logger.error(
                "Error routing intent to %s (DataCenter %s): %s",
                target_url,
                datacenter,
                exc,
                exc_info=True,
            )
            return (
                {
                    "code": "500",
                    "reason": f"Internal error routing to DataCenter {datacenter}: {str(exc)}",
                },
                500,
                {},
            )
