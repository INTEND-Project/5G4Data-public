from __future__ import annotations

import threading
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from inserv.models.intent_report import IntentReport


class IntentReportRepository:
    """Simple in-memory repository for intent reports."""

    def __init__(self) -> None:
        self._reports_by_intent: Dict[str, List[IntentReport]] = defaultdict(list)
        self._lock = threading.Lock()

    def save(self, report: IntentReport) -> IntentReport:
        with self._lock:
            reports = self._reports_by_intent[report.intent_id]
            reports.append(report)
            reports.sort(key=lambda item: item.report_number)
        return report

    def list(
        self, intent_id: str, offset: int = 0, limit: Optional[int] = None
    ) -> Tuple[List[IntentReport], int]:
        with self._lock:
            reports = list(self._reports_by_intent.get(intent_id, []))
        total = len(reports)
        sliced = reports[offset:] if offset else reports
        if limit is not None:
            sliced = sliced[: max(limit, 0)]
        return sliced, total

    def retrieve(self, intent_id: str, report_id: str) -> Optional[IntentReport]:
        with self._lock:
            for report in self._reports_by_intent.get(intent_id, []):
                if report.id == report_id:
                    return report
        return None

    def delete(self, intent_id: str, report_id: str) -> bool:
        with self._lock:
            reports = self._reports_by_intent.get(intent_id, [])
            before = len(reports)
            self._reports_by_intent[intent_id] = [
                report for report in reports if report.id != report_id
            ]
            return len(self._reports_by_intent[intent_id]) != before

    def next_report_number(self, intent_id: str) -> int:
        with self._lock:
            reports = self._reports_by_intent.get(intent_id, [])
            if not reports:
                return 1
            return max(report.report_number for report in reports) + 1

