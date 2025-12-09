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


def listIntentSpecification(fields=None, offset=None, limit=None):
    """List intent specifications - not implemented in inServ"""
    logger.warning("listIntentSpecification called but not implemented in inServ")
    return _not_implemented()


def createIntentSpecification(body, fields=None):
    """Create intent specification - not implemented in inServ"""
    logger.warning("createIntentSpecification called but not implemented in inServ")
    return _not_implemented()


def retrieveIntentSpecification(id, fields=None):
    """Retrieve intent specification - not implemented in inServ"""
    logger.warning("retrieveIntentSpecification called but not implemented in inServ")
    return _not_implemented()


def patchIntentSpecification(id, body, fields=None):
    """Patch intent specification - not implemented in inServ"""
    logger.warning("patchIntentSpecification called but not implemented in inServ")
    return _not_implemented()


def deleteIntentSpecification(id):
    """Delete intent specification - not implemented in inServ"""
    logger.warning("deleteIntentSpecification called but not implemented in inServ")
    return _not_implemented()
