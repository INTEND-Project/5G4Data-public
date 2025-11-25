from __future__ import annotations

import logging
import connexion
from flask import current_app, jsonify

from inserv.exceptions import IntentConflict, IntentNotFound
from inserv.models.intent import Intent  # noqa: E501
from inserv.models.intent_fvo import IntentFVO  # noqa: E501
from inserv.models.intent_mvo import IntentMVO  # noqa: E501

logger = logging.getLogger(__name__)


def _service():
    return current_app.config["INTENT_SERVICE"]


def _project(model: Intent, fields: str | None):
    data = model.to_dict()
    # Add @type field required by TM Forum API specification
    data["@type"] = "Intent"
    
    if not fields:
        return data
    requested = {field.strip() for field in fields.split(",") if field.strip()}
    if not requested:
        return data
    # Always include @type even if not explicitly requested
    filtered = {key: value for key, value in data.items() if key in requested}
    if "@type" not in filtered:
        filtered["@type"] = "Intent"
    return filtered


def create_intent(body, fields=None):  # noqa: E501
    """Creates an Intent"""
    try:
        intent_fvo = body
        request_json = None
        if connexion.request.is_json:
            request_json = connexion.request.get_json()
            logger.debug(f"Received intent creation request: {request_json}")
            intent_fvo = IntentFVO.from_dict(request_json)
        # Pass the original request JSON to preserve fields not in IntentFVO (like expression)
        intent = _service().create_intent(intent_fvo, original_request_json=request_json)
        return _project(intent, fields), 201
    except IntentConflict as exc:
        logger.warning(f"Intent conflict: {exc}")
        return _error_response(str(exc), 409)
    except Exception as exc:
        logger.error(f"Error creating intent: {exc}", exc_info=True)
        return _error_response(f"Internal server error: {str(exc)}", 500)


def delete_intent(id):  # noqa: E501
    """Deletes an Intent"""
    try:
        _service().delete_intent(id)
    except IntentNotFound as exc:
        return _error_response(str(exc), 404)
    return "", 204


def list_intent(fields=None, offset=None, limit=None):  # noqa: E501
    """List or find Intent objects"""
    intents, total = _service().list_intents(
        offset=offset or 0, limit=limit
    )
    payload = [_project(intent, fields) for intent in intents]
    headers = {
        "X-Total-Count": str(total),
        "X-Result-Count": str(len(payload)),
    }
    return payload, 200, headers


def patch_intent(id, body, fields=None):  # noqa: E501
    """Updates partially an Intent"""
    intent_mvo = body
    if connexion.request.is_json:
        intent_mvo = IntentMVO.from_dict(connexion.request.get_json())
    try:
        updated = _service().patch_intent(id, intent_mvo)
    except IntentNotFound as exc:
        return _error_response(str(exc), 404)
    return _project(updated, fields), 200


def retrieve_intent(id, fields=None):  # noqa: E501
    """Retrieves an Intent by ID"""
    try:
        intent = _service().retrieve_intent(id)
    except IntentNotFound as exc:
        return _error_response(str(exc), 404)
    return _project(intent, fields), 200


def _error_response(reason: str, status_code: int):
    body = {"code": str(status_code), "reason": reason}
    return jsonify(body), status_code


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
