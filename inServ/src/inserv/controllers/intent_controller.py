from __future__ import annotations

import logging
import connexion
from flask import current_app, jsonify

logger = logging.getLogger(__name__)


def _infrastructure_service():
    """Get the infrastructure service from Flask app config."""
    return current_app.config.get("INFRASTRUCTURE_SERVICE")


def _intent_router():
    """Get the intent router from Flask app config."""
    return current_app.config.get("INTENT_ROUTER")


def _turtle_parser():
    """Get or create turtle parser."""
    from inserv.services.turtle_parser import TurtleParser
    if "TURTLE_PARSER" not in current_app.config:
        current_app.config["TURTLE_PARSER"] = TurtleParser()
    return current_app.config["TURTLE_PARSER"]


def _error_response(reason: str, status_code: int):
    """Create an error response."""
    body = {"code": str(status_code), "reason": reason}
    return jsonify(body), status_code


def create_intent(body, fields=None):  # noqa: E501
    """
    Creates an Intent by routing it to the appropriate inOrch-TMF-Proxy.
    
    This endpoint:
    1. Extracts the turtle expression from the intent
    2. Parses the DataCenter from the turtle
    3. Routes the intent to the appropriate inOrch-TMF-Proxy instance
    """
    try:
        request_json = None
        if connexion.request.is_json:
            request_json = connexion.request.get_json()
            logger.debug(f"Received intent creation request: {request_json}")
        else:
            logger.warning("Received intent creation request without JSON body")
            return _error_response("Request body must be JSON", 400)
        
        if not request_json:
            return _error_response("Empty request body", 400)
        
        # Extract turtle expression from intent
        expression = request_json.get("expression")
        if not expression or not isinstance(expression, dict):
            logger.warning("Intent does not contain expression field")
            return _error_response("Intent must contain an expression field", 400)
        
        expr_type = expression.get("@type", "")
        if expr_type != "TurtleExpression":
            logger.warning("Intent expression type is not TurtleExpression: %s", expr_type)
            return _error_response("Intent expression must be of type TurtleExpression", 400)
        
        turtle_data = expression.get("expressionValue", "")
        if not turtle_data:
            logger.warning("Intent expressionValue is empty")
            return _error_response("Intent expressionValue cannot be empty", 400)
        
        # Parse DataCenter from turtle
        turtle_parser = _turtle_parser()
        datacenter = turtle_parser.parse_datacenter(turtle_data)
        
        if not datacenter:
            logger.error("Could not extract DataCenter from turtle expression")
            return _error_response(
                "Could not extract DataCenter from intent expression",
                400,
            )
        
        logger.info("Extracted DataCenter: %s from intent", datacenter)
        
        # Route intent to appropriate proxy
        intent_router = _intent_router()
        if not intent_router:
            logger.error("Intent router not available")
            return _error_response("Intent router not configured", 500)
        
        try:
            response_data, status_code, headers = intent_router.route_intent(
                request_json, datacenter
            )
        except RuntimeError as exc:
            # GraphDB unavailable or DataCenter not found
            logger.error("Failed to route intent: %s", exc)
            return _error_response(
                f"Cannot route intent: {str(exc)}",
                503,
            )
        
        # Return the response from the proxy
        if response_data:
            # Add @type if not present
            if "@type" not in response_data:
                response_data["@type"] = "Intent"
            
            # Handle field projection if requested
            if fields:
                requested = {field.strip() for field in fields.split(",") if field.strip()}
                if requested:
                    filtered = {key: value for key, value in response_data.items() if key in requested}
                    if "@type" not in filtered:
                        filtered["@type"] = "Intent"
                    response_data = filtered
        
        return jsonify(response_data), status_code, headers
        
    except Exception as exc:
        logger.error(f"Error creating intent: {exc}", exc_info=True)
        return _error_response(f"Internal server error: {str(exc)}", 500)


def delete_intent(id):  # noqa: E501
    """Deletes an Intent - not implemented in inServ (proxy handles this)"""
    logger.warning("delete_intent called but not implemented in inServ")
    return _error_response("Delete intent not supported in inServ", 501)


def list_intent(fields=None, offset=None, limit=None):  # noqa: E501
    """List or find Intent objects - not implemented in inServ (proxy handles this)"""
    logger.warning("list_intent called but not implemented in inServ")
    return _error_response("List intent not supported in inServ", 501)


def patch_intent(id, body, fields=None):  # noqa: E501
    """Updates partially an Intent - not implemented in inServ (proxy handles this)"""
    logger.warning("patch_intent called but not implemented in inServ")
    return _error_response("Patch intent not supported in inServ", 501)


def retrieve_intent(id, fields=None):  # noqa: E501
    """Retrieves an Intent by ID - not implemented in inServ (proxy handles this)"""
    logger.warning("retrieve_intent called but not implemented in inServ")
    return _error_response("Retrieve intent not supported in inServ", 501)


# TMF921 operationId wrappers (camelCase)
def listIntent(fields=None, offset=None, limit=None):
    return list_intent(fields=fields, offset=offset, limit=limit)


def createIntent(body, fields=None):
    return create_intent(body=body, fields=fields)


def retrieveIntent(id, fields=None):
    return retrieve_intent(id=id, fields=fields)


def patchIntent(id, body, fields=None):
    return patch_intent(id=id, body=body, fields=fields)


def deleteIntent(id):
    return delete_intent(id=id)
