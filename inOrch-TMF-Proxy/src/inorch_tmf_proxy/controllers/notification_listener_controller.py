from __future__ import annotations

import logging
from flask import request

logger = logging.getLogger(__name__)


def _ack(event_name: str):
    logger.info("Received TMF notification '%s': %s", event_name, request.get_json(silent=True))
    return "", 204


def intentAttributeValueChangeEvent(body):
    return _ack("intentAttributeValueChangeEvent")


def intentCreateEvent(body):
    return _ack("intentCreateEvent")


def intentDeleteEvent(body):
    return _ack("intentDeleteEvent")


def intentReportAttributeValueChangeEvent(body):
    return _ack("intentReportAttributeValueChangeEvent")


def intentReportCreateEvent(body):
    return _ack("intentReportCreateEvent")


def intentReportDeleteEvent(body):
    return _ack("intentReportDeleteEvent")


def intentSpecificationAttributeValueChangeEvent(body):
    return _ack("intentSpecificationAttributeValueChangeEvent")


def intentSpecificationCreateEvent(body):
    return _ack("intentSpecificationCreateEvent")


def intentSpecificationDeleteEvent(body):
    return _ack("intentSpecificationDeleteEvent")


def intentSpecificationStatusChangeEvent(body):
    return _ack("intentSpecificationStatusChangeEvent")


def intentStatusChangeEvent(body):
    return _ack("intentStatusChangeEvent")

