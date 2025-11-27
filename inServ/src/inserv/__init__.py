from __future__ import annotations

from typing import TYPE_CHECKING

from inserv.config import AppConfig
from inserv.logging_config import configure_logging
from inserv.repositories.intent_repository import IntentRepository
from inserv.repositories.intent_report_repository import IntentReportRepository
from inserv.repositories.hub_subscription_repository import HubSubscriptionRepository
from inserv.services.intent_service import IntentService
from inserv.services.k8s_deployer import KubernetesDeployer
from inserv.services.helm_deployer import HelmDeployer
from inserv.services.reporting_service import IntentReportingService
from inserv.services.notification_dispatcher import http_notification_sender
from inserv.services.observation_scheduler import ObservationScheduler

try:
    from intent_report_client import GraphDbClient
except ImportError:
    GraphDbClient = None  # type: ignore

if TYPE_CHECKING:  # pragma: no cover
    import connexion


def create_app(config: AppConfig | None = None) -> "connexion.App":
    """Create and configure the Connexion application instance."""
    import connexion
    import logging
    from flask import request, jsonify
    from inserv.health import register_health_blueprint
    config = config or AppConfig.from_env()
    configure_logging(config.log_level)

    connexion_app = connexion.App(__name__, specification_dir="./openapi/")
    connexion_app.add_api(
        "openapi.yaml",
        arguments={"title": "INTEND 5G4DATA use case; Intent Management API"},
        pythonic_params=True,
        validate_responses=False,
        strict_validation=False,
    )

    flask_app = connexion_app.app
    flask_app.config["APP_CONFIG"] = config
    
    # Add request logging
    logger = logging.getLogger(__name__)
    
    @flask_app.before_request
    def log_request_info():
        logger.info(f"Request: {request.method} {request.path}")
        if request.is_json:
            try:
                logger.debug(f"Request body: {request.get_json()}")
            except Exception as e:
                logger.warning(f"Failed to parse request body: {e}")
    
    @flask_app.after_request
    def log_response_info(response):
        logger.info(f"Response: {response.status_code}")
        return response
    
    @flask_app.errorhandler(Exception)
    def handle_exception(e):
        logger.error(f"Unhandled exception: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
    
    @flask_app.errorhandler(500)
    def handle_500(e):
        logger.error(f"500 error: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

    intent_repository = IntentRepository()
    report_repository = IntentReportRepository()
    hub_repository = HubSubscriptionRepository()
    deployer = KubernetesDeployer(config)
    helm_deployer = HelmDeployer(config)
    reporting_service = IntentReportingService(
        report_repository=report_repository,
        hub_repository=hub_repository,
        handler_name=config.reporting_handler,
        owner_name=config.reporting_owner,
        notification_sender=http_notification_sender(),
    )

    observation_scheduler = (
        ObservationScheduler(
            reporting_service=reporting_service,
            interval_seconds=config.observation_interval_seconds,
            metric_name=config.observation_metric_name,
        )
        if config.enable_observation_reports
        else None
    )

    graphdb_client = (
        GraphDbClient(
            base_url=config.graphdb_base_url,
            repository=config.graphdb_repository,
        )
        if config.enable_graphdb and GraphDbClient is not None
        else None
    )

    flask_app.config["INTENT_REPORT_REPOSITORY"] = report_repository
    flask_app.config["HUB_REPOSITORY"] = hub_repository
    flask_app.config["REPORTING_SERVICE"] = reporting_service
    flask_app.config["OBSERVATION_SCHEDULER"] = observation_scheduler
    flask_app.config["INTENT_SERVICE"] = IntentService(
        intent_repository,
        deployer,
        helm_deployer=helm_deployer,
        reporting_service=reporting_service,
        observation_scheduler=observation_scheduler,
        graphdb_client=graphdb_client,
        handler_name=config.reporting_handler,
        owner_name=config.reporting_owner,
    )

    register_health_blueprint(flask_app)
    return connexion_app

