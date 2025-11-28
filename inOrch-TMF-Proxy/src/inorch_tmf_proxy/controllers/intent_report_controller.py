from __future__ import annotations

from flask import current_app, jsonify

from inorch_tmf_proxy.repositories.intent_report_repository import IntentReportRepository


def _repository() -> IntentReportRepository:
    return current_app.config["INTENT_REPORT_REPOSITORY"]


def list_intent_intent_report(intentId, fields=None, offset=0, limit=None):
    reports, total = _repository().list(intentId, offset=int(offset or 0), limit=limit)
    payload = [report.to_dict() for report in reports]
    headers = {
        "X-Total-Count": str(total),
        "X-Result-Count": str(len(payload)),
    }
    return payload, 200, headers


def retrieve_intent_intent_report(intentId, id, fields=None):
    report = _repository().retrieve(intentId, id)
    if not report:
        return _error_response("Intent report not found", 404)
    return report.to_dict()


def delete_intent_intent_report(intentId, id):
    deleted = _repository().delete(intentId, id)
    if not deleted:
        return _error_response("Intent report not found", 404)
    return "", 204


def _error_response(reason: str, status_code: int):
    body = {"code": str(status_code), "reason": reason}
    return jsonify(body), status_code


# TMF operationId wrappers
def listIntentIntentReport(intentId, fields=None, offset=0, limit=None):
    return list_intent_intent_report(
        intentId=intentId, fields=fields, offset=offset, limit=limit
    )


def retrieveIntentIntentReport(intentId, id, fields=None):
    return retrieve_intent_intent_report(intentId=intentId, id=id, fields=fields)


def deleteIntentIntentReport(intentId, id):
    return delete_intent_intent_report(intentId=intentId, id=id)

