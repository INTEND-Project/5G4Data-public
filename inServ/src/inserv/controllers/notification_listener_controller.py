from __future__ import annotations

import logging
from flask import jsonify

logger = logging.getLogger(__name__)


def _not_implemented():
    """Return 501 Not Implemented response."""
    return jsonify({
        "code": "501",
        "reason": "Not implemented in inServ",
        "message": "This endpoint is not implemented in inServ"
    }), 501


# Stub implementations for all notification listener endpoints
def listenerOnIntentAttributeValueChangeNotification(body):
    logger.warning("listenerOnIntentAttributeValueChangeNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentCreateNotification(body):
    logger.warning("listenerOnIntentCreateNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentDeleteNotification(body):
    logger.warning("listenerOnIntentDeleteNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentStateChangeNotification(body):
    logger.warning("listenerOnIntentStateChangeNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentUpdateNotification(body):
    logger.warning("listenerOnIntentUpdateNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentReportAttributeValueChangeNotification(body):
    logger.warning("listenerOnIntentReportAttributeValueChangeNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentReportCreateNotification(body):
    logger.warning("listenerOnIntentReportCreateNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentReportDeleteNotification(body):
    logger.warning("listenerOnIntentReportDeleteNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentReportStateChangeNotification(body):
    logger.warning("listenerOnIntentReportStateChangeNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentReportUpdateNotification(body):
    logger.warning("listenerOnIntentReportUpdateNotification called but not implemented")
    return _not_implemented()


def listenerOnIntentSpecificationAttributeValueChangeNotification(body):
    logger.warning("listenerOnIntentSpecificationAttributeValueChangeNotification called but not implemented")
    return _not_implemented()


# Functions expected by OpenAPI spec (operationIds)
def intentAttributeValueChangeEvent(body):
    """Intent attribute value change event - not implemented in inServ"""
    logger.warning("intentAttributeValueChangeEvent called but not implemented")
    return _not_implemented()


def intentCreateEvent(body):
    """Intent create event - not implemented in inServ"""
    logger.warning("intentCreateEvent called but not implemented")
    return _not_implemented()


def intentDeleteEvent(body):
    """Intent delete event - not implemented in inServ"""
    logger.warning("intentDeleteEvent called but not implemented")
    return _not_implemented()


def intentStatusChangeEvent(body):
    """Intent status change event - not implemented in inServ"""
    logger.warning("intentStatusChangeEvent called but not implemented")
    return _not_implemented()


def intentReportAttributeValueChangeEvent(body):
    """Intent report attribute value change event - not implemented in inServ"""
    logger.warning("intentReportAttributeValueChangeEvent called but not implemented")
    return _not_implemented()


def intentReportCreateEvent(body):
    """Intent report create event - not implemented in inServ"""
    logger.warning("intentReportCreateEvent called but not implemented")
    return _not_implemented()


def intentReportDeleteEvent(body):
    """Intent report delete event - not implemented in inServ"""
    logger.warning("intentReportDeleteEvent called but not implemented")
    return _not_implemented()


def intentSpecificationAttributeValueChangeEvent(body):
    """Intent specification attribute value change event - not implemented in inServ"""
    logger.warning("intentSpecificationAttributeValueChangeEvent called but not implemented")
    return _not_implemented()


def intentSpecificationCreateEvent(body):
    """Intent specification create event - not implemented in inServ"""
    logger.warning("intentSpecificationCreateEvent called but not implemented")
    return _not_implemented()


def intentSpecificationDeleteEvent(body):
    """Intent specification delete event - not implemented in inServ"""
    logger.warning("intentSpecificationDeleteEvent called but not implemented")
    return _not_implemented()


def intentSpecificationStatusChangeEvent(body):
    """Intent specification status change event - not implemented in inServ"""
    logger.warning("intentSpecificationStatusChangeEvent called but not implemented")
    return _not_implemented()
