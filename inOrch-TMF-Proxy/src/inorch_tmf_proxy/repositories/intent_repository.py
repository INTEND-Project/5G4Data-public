from __future__ import annotations

import copy
import threading
from typing import Dict, List, Tuple

from inorch_tmf_proxy.models.intent import Intent


class IntentRepository:
    """In-memory repository for Intent resources.

    This simplistic implementation keeps the service stateless with respect to
    persistent storage, which is sufficient for the current prototype. Replace
    with a real database for production workloads.
    """

    def __init__(self):
        self._records: Dict[str, Intent] = {}
        self._lock = threading.Lock()

    def save(self, intent: Intent) -> Intent:
        with self._lock:
            self._records[intent.id] = copy.deepcopy(intent)
        return intent

    def list(self, offset: int = 0, limit: int | None = None) -> Tuple[List[Intent], int]:
        with self._lock:
            items = list(self._records.values())
        total = len(items)
        start = max(offset or 0, 0)
        sliced = items[start:]
        if limit is not None:
            sliced = sliced[: max(limit, 0)]
        return [copy.deepcopy(item) for item in sliced], total

    def get(self, intent_id: str) -> Intent | None:
        with self._lock:
            intent = self._records.get(intent_id)
        return copy.deepcopy(intent) if intent else None

    def delete(self, intent_id: str) -> Intent | None:
        with self._lock:
            intent = self._records.pop(intent_id, None)
        return copy.deepcopy(intent) if intent else None


