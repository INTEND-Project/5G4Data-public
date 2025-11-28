from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass(slots=True)
class ObservationMetric:
    """Single metric entry inside an observation report."""

    name: str
    value: float
    unit: str | None = None
    labels: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "name": self.name,
            "value": self.value,
        }
        if self.unit:
            payload["unit"] = self.unit
        if self.labels:
            payload["labels"] = self.labels
        return payload

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ObservationMetric":
        return cls(
            name=data["name"],
            value=float(data["value"]),
            unit=data.get("unit"),
            labels=dict(data.get("labels", {})),
        )

