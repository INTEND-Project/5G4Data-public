from __future__ import annotations

import logging
import random
import threading
from typing import Dict

from inserv.models.intent import Intent
from inserv.models.report_metric import ObservationMetric
from inserv.services.reporting_service import IntentReportingService


class ObservationScheduler:
    """Simple background scheduler that produces observation intent reports."""

    def __init__(
        self,
        reporting_service: IntentReportingService,
        interval_seconds: int,
        metric_name: str = "intent_latency_ms",
    ) -> None:
        self._reporting = reporting_service
        self._interval = max(5, interval_seconds)
        self._metric_name = metric_name
        self._jobs: Dict[str, _ObservationJob] = {}
        self._lock = threading.Lock()
        self._logger = logging.getLogger(self.__class__.__name__)

    def start_for_intent(self, intent: Intent) -> None:
        with self._lock:
            if intent.id in self._jobs:
                return
            job = _ObservationJob(
                intent_id=intent.id,
                report_callback=self._record_observation,
                interval=self._interval,
            )
            self._jobs[intent.id] = job
            job.start()
            self._logger.debug("Started observation job for intent %s", intent.id)

    def stop_for_intent(self, intent_id: str) -> None:
        with self._lock:
            job = self._jobs.pop(intent_id, None)
        if job:
            job.stop()
            self._logger.debug("Stopped observation job for intent %s", intent_id)

    def _record_observation(self, intent_id: str) -> None:
        metric = ObservationMetric(
            name=self._metric_name,
            value=random.uniform(5.0, 50.0),
            unit="ms",
            labels={"intentId": intent_id},
        )
        self._reporting.record_observation_report(
            intent_id=intent_id,
            metrics=[metric],
            summary="Automated observation sample",
        )


class _ObservationJob:
    def __init__(self, intent_id: str, report_callback, interval: int) -> None:
        self._intent_id = intent_id
        self._report_callback = report_callback
        self._interval = interval
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=self._interval + 1)

    def _run(self) -> None:
        while not self._stop_event.wait(self._interval):
            self._report_callback(self._intent_id)

