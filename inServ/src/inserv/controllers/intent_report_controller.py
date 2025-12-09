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


def listIntentReport(fields=None, offset=None, limit=None):
    """List intent reports - not implemented in inServ"""
    logger.warning("listIntentReport called but not implemented in inServ")
    return _not_implemented()


def createIntentReport(body, fields=None):
    """Create intent report - not implemented in inServ"""
    logger.warning("createIntentReport called but not implemented in inServ")
    return _not_implemented()


def retrieveIntentReport(id, fields=None):
    """Retrieve intent report - not implemented in inServ"""
    logger.warning("retrieveIntentReport called but not implemented in inServ")
    return _not_implemented()


# Functions for /intent/{intentId}/intentReport endpoints
def listIntentIntentReport(intentId, fields=None, offset=None, limit=None):
    """List intent reports for a specific intent - not implemented in inServ"""
    logger.warning("listIntentIntentReport called but not implemented in inServ")
    return _not_implemented()


def deleteIntentIntentReport(intentId, id):
    """Delete intent report for a specific intent - not implemented in inServ"""
    logger.warning("deleteIntentIntentReport called but not implemented in inServ")
    return _not_implemented()


def retrieveIntentIntentReport(intentId, id, fields=None):
    """Retrieve intent report for a specific intent - not implemented in inServ"""
    logger.warning("retrieveIntentIntentReport called but not implemented in inServ")
    return _not_implemented()
