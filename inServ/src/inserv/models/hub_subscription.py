from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import uuid4

from inserv.models.report_enums import IntentEventType


@dataclass(slots=True)
class HubSubscription:
    """Represents a TMF hub subscription for intent / report events."""

    callback: str
    event_types: List[IntentEventType]
    query: Optional[str] = None
    headers: Dict[str, str] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, str | List[str] | Dict[str, str]]:
        payload: Dict[str, str | List[str] | Dict[str, str]] = {
            "id": self.id,
            "callback": self.callback,
            "eventTypes": [event.value for event in self.event_types],
            "createdAt": self.created_at.isoformat(),
        }
        if self.query:
            payload["query"] = self.query
        if self.headers:
            payload["headers"] = self.headers
        return payload

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "HubSubscription":
        return cls(
            id=str(data.get("id") or uuid4()),
            callback=str(data["callback"]),
            event_types=[IntentEventType(value) for value in data.get("eventTypes", [])],
            query=data.get("query"),
            headers=dict(data.get("headers", {})),
            created_at=datetime.fromisoformat(
                str(data.get("createdAt", datetime.now(timezone.utc).isoformat()))
            ),
        )

