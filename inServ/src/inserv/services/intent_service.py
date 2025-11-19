from __future__ import annotations

import logging
from typing import List, Tuple
from uuid import uuid4

from inserv.exceptions import IntentConflict, IntentNotFound
from inserv.models.intent import Intent
from inserv.models.intent_fvo import IntentFVO
from inserv.models.intent_mvo import IntentMVO
from inserv.repositories.intent_repository import IntentRepository
from inserv.services.k8s_deployer import KubernetesDeployer
from inserv.services.reporting_service import IntentReportingService
from inserv.services.observation_scheduler import ObservationScheduler
from inserv.models.report_enums import HandlingState


class IntentService:
    """Business logic around Intent lifecycle management."""

    def __init__(
        self,
        repository: IntentRepository,
        deployer: KubernetesDeployer,
        reporting_service: IntentReportingService | None = None,
        observation_scheduler: ObservationScheduler | None = None,
    ) -> None:
        self._repository = repository
        self._deployer = deployer
        self._reporting = reporting_service
        self._scheduler = observation_scheduler
        self._logger = logging.getLogger(self.__class__.__name__)

    def create_intent(self, payload: IntentFVO) -> Intent:
        intent_dict = payload.to_dict()
        intent_id = intent_dict.get("id") or str(uuid4())
        intent_dict["id"] = intent_id
        if self._repository.get(intent_id):
            raise IntentConflict(f"Intent {intent_id} already exists")

        intent = Intent.from_dict(intent_dict)
        self._repository.save(intent)
        self._deployer.deploy_for_intent(intent)
        if self._reporting:
            self._reporting.record_state_report(
                intent,
                state=HandlingState.INTENT_RECEIVED,
                summary="Intent received",
            )
        if self._scheduler:
            self._scheduler.start_for_intent(intent)
        self._logger.info("Created intent_id=%s", intent_id)
        return intent

    def list_intents(self, offset: int = 0, limit: int | None = None) -> Tuple[List[Intent], int]:
        return self._repository.list(offset=offset, limit=limit)

    def retrieve_intent(self, intent_id: str) -> Intent:
        intent = self._repository.get(intent_id)
        if not intent:
            raise IntentNotFound(f"Intent {intent_id} not found")
        return intent

    def patch_intent(self, intent_id: str, payload: IntentMVO) -> Intent:
        existing = self._repository.get(intent_id)
        if not existing:
            raise IntentNotFound(f"Intent {intent_id} not found")

        merged = existing.to_dict()
        for key, value in payload.to_dict().items():
            if value is not None:
                merged[key] = value

        updated = Intent.from_dict(merged)
        self._repository.save(updated)
        self._deployer.deploy_for_intent(updated)
        if self._reporting:
            self._reporting.record_state_report(
                updated,
                state=HandlingState.COMPLIANT,
                summary="Intent updated",
            )
        self._logger.info("Patched intent_id=%s", intent_id)
        return updated

    def delete_intent(self, intent_id: str) -> None:
        deleted = self._repository.delete(intent_id)
        if not deleted:
            raise IntentNotFound(f"Intent {intent_id} not found")
        self._deployer.delete_for_intent(intent_id)
        if self._scheduler:
            self._scheduler.stop_for_intent(intent_id)
        if self._reporting and deleted:
            self._reporting.record_state_report(
                Intent.from_dict({"id": intent_id}),
                state=HandlingState.FINALIZING,
                summary="Intent deleted",
            )
        self._logger.info("Deleted intent_id=%s", intent_id)


