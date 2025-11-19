from __future__ import annotations

import connexion
from flask import current_app, jsonify

from inserv.models.hub_subscription import HubSubscription
from inserv.models.report_enums import IntentEventType


def _repository():
    return current_app.config["HUB_REPOSITORY"]


def create_hub(body):
    payload = body
    if connexion.request.is_json:
        payload = connexion.request.get_json()
    event_types = [
        IntentEventType(value)
        for value in payload.get("eventTypes", [IntentEventType.INTENT_REPORT_CREATE.value])
    ]
    subscription = HubSubscription(
        callback=payload["callback"],
        event_types=event_types,
        query=payload.get("query"),
        headers=payload.get("headers") or {},
    )
    _repository().save(subscription)
    return subscription.to_dict(), 201


def hub_get(id):
    subscription = _repository().get(id)
    if not subscription:
        return _error_response("Hub subscription not found", 404)
    return subscription.to_dict()


def hub_delete(id):
    deleted = _repository().delete(id)
    if not deleted:
        return _error_response("Hub subscription not found", 404)
    return "", 204


def _error_response(reason: str, status_code: int):
    body = {"code": str(status_code), "reason": reason}
    return jsonify(body), status_code


# TMF operationId wrappers
def createHub(body):
    return create_hub(body)


def hubGet(id):
    return hub_get(id)


def hubDelete(id):
    return hub_delete(id)

