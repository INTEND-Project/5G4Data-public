from __future__ import annotations

import threading
from typing import Dict, List, Optional

from inorch_tmf_proxy.models.hub_subscription import HubSubscription
from inorch_tmf_proxy.models.report_enums import IntentEventType


class HubSubscriptionRepository:
    """Stores hub subscriptions for event delivery."""

    def __init__(self) -> None:
        self._records: Dict[str, HubSubscription] = {}
        self._lock = threading.Lock()

    def save(self, subscription: HubSubscription) -> HubSubscription:
        with self._lock:
            self._records[subscription.id] = subscription
        return subscription

    def list(self) -> List[HubSubscription]:
        with self._lock:
            return list(self._records.values())

    def get(self, subscription_id: str) -> Optional[HubSubscription]:
        with self._lock:
            return self._records.get(subscription_id)

    def delete(self, subscription_id: str) -> bool:
        with self._lock:
            if subscription_id in self._records:
                del self._records[subscription_id]
                return True
        return False

    def find_by_event(
        self, event_type: IntentEventType, intent_id: Optional[str] = None
    ) -> List[HubSubscription]:
        candidates = []
        for subscription in self.list():
            if event_type not in subscription.event_types:
                continue
            if subscription.query and intent_id:
                if intent_id not in subscription.query:
                    continue
            candidates.append(subscription)
        return candidates

