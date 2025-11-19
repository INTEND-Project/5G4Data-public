from __future__ import annotations

import connexion
from flask import current_app, jsonify

from inserv.exceptions import IntentConflict, IntentNotFound
from inserv.models.intent import Intent  # noqa: E501
from inserv.models.intent_fvo import IntentFVO  # noqa: E501
from inserv.models.intent_mvo import IntentMVO  # noqa: E501


def _service():
    return current_app.config["INTENT_SERVICE"]


def _project(model: Intent, fields: str | None):
    data = model.to_dict()
    if not fields:
        return data
    requested = {field.strip() for field in fields.split(",") if field.strip()}
    if not requested:
        return data
    return {key: value for key, value in data.items() if key in requested}


def create_intent(body, fields=None):  # noqa: E501
    """Creates an Intent"""
    intent_fvo = body
    if connexion.request.is_json:
        intent_fvo = IntentFVO.from_dict(connexion.request.get_json())
    try:
        intent = _service().create_intent(intent_fvo)
    except IntentConflict as exc:
        return _error_response(str(exc), 409)
    return _project(intent, fields), 201


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
