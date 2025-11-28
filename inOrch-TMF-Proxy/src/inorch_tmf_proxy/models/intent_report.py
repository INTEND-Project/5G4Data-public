from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from inorch_tmf_proxy.models.report_enums import HandlingState, ReportType
from inorch_tmf_proxy.models.report_metric import ObservationMetric


@dataclass(slots=True)
class IntentReport:
    """Represents a TMF921 intent report (state or observation)."""

    intent_id: str
    report_type: ReportType
    report_number: int
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    id: str = field(default_factory=lambda: str(uuid4()))
    handling_state: Optional[HandlingState] = None
    reason: Optional[str] = None
    handler: Optional[str] = None
    owner: Optional[str] = None
    summary: Optional[str] = None
    metrics: List[ObservationMetric] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "intentId": self.intent_id,
            "reportNumber": self.report_number,
            "reportType": self.report_type.value,
            "generatedAt": self.generated_at.isoformat(),
            "metrics": [metric.to_dict() for metric in self.metrics],
            "details": self.details,
        }
        if self.handling_state:
            payload["handlingState"] = self.handling_state.value
        if self.reason:
            payload["reason"] = self.reason
        if self.handler:
            payload["handler"] = self.handler
        if self.owner:
            payload["owner"] = self.owner
        if self.summary:
            payload["summary"] = self.summary
        return payload

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "IntentReport":
        metrics = [
            ObservationMetric.from_dict(item) for item in data.get("metrics", [])
        ]
        generated_at = datetime.fromisoformat(
            data["generatedAt"]
        )
        return cls(
            id=data.get("id", str(uuid4())),
            intent_id=data["intentId"],
            report_number=int(data["reportNumber"]),
            report_type=ReportType(data["reportType"]),
            generated_at=generated_at,
            handling_state=HandlingState(data["handlingState"])
            if data.get("handlingState")
            else None,
            reason=data.get("reason"),
            handler=data.get("handler"),
            owner=data.get("owner"),
            summary=data.get("summary"),
            metrics=metrics,
            details=dict(data.get("details", {})),
        )


@dataclass(slots=True)
class IntentReportEnvelope:
    """Wrapper for pushing reports through hub notifications."""

    event_type: str
    event_time: datetime
    report: IntentReport

    def to_dict(self) -> Dict[str, Any]:
        return {
            "eventType": self.event_type,
            "eventTime": self.event_time.isoformat(),
            "resource": self.report.to_dict(),
        }

