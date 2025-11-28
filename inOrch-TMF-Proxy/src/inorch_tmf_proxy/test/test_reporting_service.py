from __future__ import annotations

import unittest

from inorch_tmf_proxy.models.intent import Intent
from inorch_tmf_proxy.models.hub_subscription import HubSubscription
from inorch_tmf_proxy.models.report_enums import (
    HandlingState,
    IntentEventType,
)
from inorch_tmf_proxy.repositories.hub_subscription_repository import HubSubscriptionRepository
from inorch_tmf_proxy.repositories.intent_report_repository import IntentReportRepository
from inorch_tmf_proxy.services.reporting_service import IntentReportingService


class IntentReportingServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.report_repo = IntentReportRepository()
        self.hub_repo = HubSubscriptionRepository()
        self.sent_events = []

        def sender(subscription, event):
            self.sent_events.append((subscription, event))

        self.service = IntentReportingService(
            report_repository=self.report_repo,
            hub_repository=self.hub_repo,
            handler_name="unit-handler",
            owner_name="unit-owner",
            notification_sender=sender,
        )

        self.intent = Intent.from_dict({"id": "Intent-1", "name": "Unit Test Intent"})

    def test_record_state_report_persists_and_notifies(self):
        subscription = HubSubscription(
            callback="https://callback.local",
            event_types=[IntentEventType.INTENT_REPORT_CREATE],
        )
        self.hub_repo.save(subscription)

        report = self.service.record_state_report(
            self.intent,
            state=HandlingState.INTENT_RECEIVED,
            summary="intent accepted",
        )

        reports, total = self.report_repo.list(self.intent.id)
        self.assertEqual(1, total)
        self.assertEqual(report.id, reports[0].id)
        self.assertEqual("unit-handler", report.handler)
        self.assertEqual(1, report.report_number)
        self.assertEqual(1, len(self.sent_events))
        sent_subscription, event = self.sent_events[0]
        self.assertEqual(subscription.id, sent_subscription.id)
        self.assertEqual(IntentEventType.INTENT_REPORT_CREATE.value, event.event_type.value)

    def test_record_observation_report_assigns_incremental_numbers(self):
        self.service.record_observation_report(
            intent_id=self.intent.id,
            metrics=[],
        )
        second_report = self.service.record_observation_report(
            intent_id=self.intent.id,
            metrics=[],
        )
        self.assertEqual(2, second_report.report_number)


if __name__ == "__main__":
    unittest.main()

