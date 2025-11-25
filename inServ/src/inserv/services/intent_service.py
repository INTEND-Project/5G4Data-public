from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple
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

try:
    from intent_report_client import GraphDbClient, generate_turtle
except ImportError:
    GraphDbClient = None  # type: ignore
    generate_turtle = None  # type: ignore


class IntentService:
    """Business logic around Intent lifecycle management."""

    def __init__(
        self,
        repository: IntentRepository,
        deployer: KubernetesDeployer,
        reporting_service: IntentReportingService | None = None,
        observation_scheduler: ObservationScheduler | None = None,
        graphdb_client: Optional["GraphDbClient"] = None,
        handler_name: str = "inServ",
        owner_name: str | None = None,
    ) -> None:
        self._repository = repository
        self._deployer = deployer
        self._reporting = reporting_service
        self._scheduler = observation_scheduler
        self._graphdb_client = graphdb_client
        self._handler_name = handler_name
        self._owner_name = owner_name
        self._logger = logging.getLogger(self.__class__.__name__)

    def create_intent(self, payload: IntentFVO, original_request_json: dict | None = None) -> Intent:
        intent_dict = payload.to_dict()
        # Merge in fields from original request that might not be in IntentFVO model (like expression)
        if original_request_json:
            for key, value in original_request_json.items():
                if key not in intent_dict or intent_dict[key] is None:
                    intent_dict[key] = value
        
        # Try to extract intent ID from Turtle expression if present
        intent_id = intent_dict.get("id")
        if not intent_id:
            # Extract from Turtle expression if available
            expression = intent_dict.get("expression")
            if expression and isinstance(expression, dict):
                expr_type = expression.get("@type", "")
                if expr_type == "TurtleExpression":
                    turtle_data = expression.get("expressionValue", "")
                    # Extract intent ID from Turtle: data5g:I<32-char-hex>
                    import re
                    match = re.search(r'data5g:I([a-f0-9]{32})', turtle_data)
                    if match:
                        intent_id = match.group(1)
                        self._logger.info(
                            "Extracted intent_id=%s from Turtle expression", intent_id
                        )
        
        # Fall back to generating a new UUID if no ID found
        if not intent_id:
            intent_id = str(uuid4())
            self._logger.debug("Generated new intent_id=%s", intent_id)
        
        intent_dict["id"] = intent_id
        if self._repository.get(intent_id):
            raise IntentConflict(f"Intent {intent_id} already exists")

        intent = Intent.from_dict(intent_dict)
        self._repository.save(intent)
        # Kubernetes deployment temporarily disabled

        # Store intent in GraphDB if enabled (run in background to avoid blocking)
        if self._graphdb_client:
            import threading
            def store_in_graphdb():
                try:
                    # Extract turtle data from expression field
                    expression = intent_dict.get("expression")
                    stored_intent_id = None
                    if expression and isinstance(expression, dict):
                        expr_type = expression.get("@type", "")
                        if expr_type == "TurtleExpression":
                            turtle_data = expression.get("expressionValue")
                            if turtle_data:
                                stored_intent_id = self._graphdb_client.store_intent(turtle_data)
                                if stored_intent_id:
                                    self._logger.info(
                                        "Stored intent_id=%s in GraphDB", stored_intent_id
                                    )
                                else:
                                    self._logger.warning(
                                        "Failed to extract intent_id from GraphDB storage"
                                    )
                            else:
                                self._logger.warning(
                                    "Intent expressionValue is missing for intent_id=%s",
                                    intent_id,
                                )
                        else:
                            self._logger.warning(
                                "Intent expression type is not TurtleExpression for intent_id=%s: %s",
                                intent_id,
                                expr_type,
                            )
                    else:
                        self._logger.warning(
                            "Intent expression field is missing or invalid for intent_id=%s",
                            intent_id,
                        )

                    # Store initial state report in GraphDB
                    # Use stored_intent_id if available, otherwise fall back to intent_id
                    report_intent_id = stored_intent_id or intent_id
                    if generate_turtle and stored_intent_id:
                        current_time = datetime.now(timezone.utc)
                        report_data = {
                            "intent_id": report_intent_id,
                            "report_type": "STATE_CHANGE",
                            "report_number": 1,
                            "report_generated": current_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "handler": self._handler_name,
                            "owner": self._owner_name,
                            "intent_handling_state": "StateIntentReceived",
                            "reason": "Intent received and being processed",
                        }
                        turtle_report = generate_turtle(report_data)
                        self._graphdb_client.store_intent_report(turtle_report)
                        self._logger.info(
                            "Stored initial state report for intent_id=%s in GraphDB",
                            report_intent_id,
                        )
                except Exception as exc:
                    # Log but don't fail intent creation if GraphDB storage fails
                    self._logger.error(
                        "Failed to store intent or report in GraphDB for intent_id=%s: %s",
                        intent_id,
                        exc,
                        exc_info=True,
                    )
            
            # Run GraphDB operations in background thread to avoid blocking
            thread = threading.Thread(target=store_in_graphdb, daemon=True)
            thread.start()
            self._logger.debug("Started background thread for GraphDB storage of intent_id=%s", intent_id)

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


