from __future__ import annotations

import logging
from typing import Optional

from inorch_tmf_proxy.models.intent import Intent
from inorch_tmf_proxy.models.intent_report import IntentReport
from inorch_tmf_proxy.models.report_enums import HandlingState, IntentEventType, ReportType
from inorch_tmf_proxy.repositories.intent_report_repository import IntentReportRepository
from inorch_tmf_proxy.repositories.hub_subscription_repository import HubSubscriptionRepository
from inorch_tmf_proxy.models.intent_events import IntentEvent, build_intent_report_event


class IntentReportingService:
    """Handles creation of intent reports and dispatching hub notifications."""

    def __init__(
        self,
        report_repository: IntentReportRepository,
        hub_repository: HubSubscriptionRepository,
        handler_name: str = "inOrch-TMF-Proxy",
        owner_name: str | None = None,
        notification_sender: Optional[callable] = None,
    ) -> None:
        self._report_repo = report_repository
        self._hub_repo = hub_repository
        self._handler_name = handler_name
        self._owner_name = owner_name
        self._notification_sender = notification_sender
        self._logger = logging.getLogger(self.__class__.__name__)

    def record_state_report(
        self,
        intent: Intent,
        state: HandlingState,
        summary: str | None = None,
        reason: str | None = None,
    ) -> IntentReport:
        report_number = self._report_repo.next_report_number(intent.id)
        report = IntentReport(
            intent_id=intent.id,
            report_type=ReportType.STATE,
            report_number=report_number,
            handling_state=state,
            summary=summary,
            reason=reason,
            handler=self._handler_name,
            owner=self._owner_name,
        )
        self._report_repo.save(report)
        self._dispatch(report, IntentEventType.INTENT_REPORT_CREATE)
        return report

    def record_observation_report(
        self,
        intent_id: str,
        metrics,
        summary: str | None = None,
    ) -> IntentReport:
        report_number = self._report_repo.next_report_number(intent_id)
        report = IntentReport(
            intent_id=intent_id,
            report_type=ReportType.OBSERVATION,
            report_number=report_number,
            metrics=list(metrics),
            summary=summary,
            handler=self._handler_name,
            owner=self._owner_name,
        )
        self._report_repo.save(report)
        self._dispatch(report, IntentEventType.INTENT_REPORT_CREATE)
        return report

    def _dispatch(self, report: IntentReport, event_type: IntentEventType) -> None:
        if not self._notification_sender:
            return
        event: IntentEvent = build_intent_report_event(report, event_type)
        subscriptions = self._hub_repo.find_by_event(event_type, report.intent_id)
        for subscription in subscriptions:
            try:
                self._notification_sender(subscription, event)
            except Exception as exc:  # pragma: no cover - network errors
                self._logger.warning(
                    "Failed to notify subscription %s: %s", subscription.id, exc
                )

