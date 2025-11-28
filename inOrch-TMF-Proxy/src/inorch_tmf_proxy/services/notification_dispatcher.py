from __future__ import annotations

import logging
from typing import Callable

import requests

from inorch_tmf_proxy.models.hub_subscription import HubSubscription
from inorch_tmf_proxy.models.intent_events import IntentEvent

logger = logging.getLogger(__name__)


def http_notification_sender(
    session_factory: Callable[[], requests.Session] | None = None,
) -> Callable[[HubSubscription, IntentEvent], None]:
    """Create a sender function that POSTs events to hub callbacks."""

    def _send(subscription: HubSubscription, event: IntentEvent) -> None:
        session = session_factory() if session_factory else requests.Session()
        headers = {"Content-Type": "application/json"}
        if subscription.headers:
            headers.update(subscription.headers)
        response = session.post(
            subscription.callback,
            json=event.to_dict(),
            timeout=10,
            headers=headers,
        )
        response.raise_for_status()
        logger.debug(
            "Delivered event %s to %s",
            event.event_id,
            subscription.callback,
        )

    return _send

