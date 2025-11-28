from __future__ import annotations

from flask import jsonify


def _not_implemented():
    body = {"code": "501", "reason": "IntentSpecification operations not implemented"}
    return jsonify(body), 501


def listIntentSpecification(*args, **kwargs):
    return _not_implemented()


def createIntentSpecification(body, fields=None):
    return _not_implemented()


def retrieveIntentSpecification(id, fields=None):
    return _not_implemented()


def patchIntentSpecification(id, body, fields=None):
    return _not_implemented()


def deleteIntentSpecification(id):
    return _not_implemented()

