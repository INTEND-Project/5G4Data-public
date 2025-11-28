from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from inorch_tmf_proxy.models.intent_report import IntentReport
from inorch_tmf_proxy.models.report_enums import IntentEventType


@dataclass(slots=True)
class IntentEvent:
    """Base event envelope used for hub notifications."""

    event_type: IntentEventType
    payload: Dict[str, Any]
    event_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    event_id: str = field(default_factory=lambda: str(uuid4()))
    correlation_id: Optional[str] = None
    domain: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "eventId": self.event_id,
            "eventType": self.event_type.value,
            "eventTime": self.event_time.isoformat(),
            "event": self.payload,
        }
        if self.correlation_id:
            body["correlationId"] = self.correlation_id
        if self.domain:
            body["domain"] = self.domain
        if self.title:
            body["title"] = self.title
        if self.description:
            body["description"] = self.description
        if self.priority:
            body["priority"] = self.priority
        return body


def build_intent_report_event(
    report: IntentReport,
    event_type: IntentEventType,
) -> IntentEvent:
    return IntentEvent(
        event_type=event_type,
        payload={"intentReport": report.to_dict()},
    )

