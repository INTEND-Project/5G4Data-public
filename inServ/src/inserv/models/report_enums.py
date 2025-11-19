from __future__ import annotations

from enum import Enum


class ReportType(str, Enum):
    STATE = "state"
    OBSERVATION = "observation"


class HandlingState(str, Enum):
    """Intent handling states from TMF TR292B v3.6.0."""

    INTENT_RECEIVED = "StateIntentReceived"
    COMPLIANT = "StateCompliant"
    DEGRADED = "StateDegraded"
    FINALIZING = "StateFinalizing"


class IntentEventType(str, Enum):
    INTENT_CREATE = "IntentCreateEvent"
    INTENT_STATUS_CHANGE = "IntentStatusChangeEvent"
    INTENT_ATTRIBUTE_CHANGE = "IntentAttributeValueChangeEvent"
    INTENT_DELETE = "IntentDeleteEvent"
    INTENT_REPORT_CREATE = "IntentReportCreateEvent"
    INTENT_REPORT_CHANGE = "IntentReportAttributeValueChangeEvent"
    INTENT_REPORT_DELETE = "IntentReportDeleteEvent"


