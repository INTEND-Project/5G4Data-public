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


def createHub(body):
    """Create hub subscription - not implemented in inServ"""
    logger.warning("createHub called but not implemented in inServ")
    return _not_implemented()


def hubDelete(id):
    """Delete hub subscription - not implemented in inServ"""
    logger.warning("hubDelete called but not implemented in inServ")
    return _not_implemented()


def hubGet(id):
    """Get hub subscription - not implemented in inServ"""
    logger.warning("hubGet called but not implemented in inServ")
    return _not_implemented()
