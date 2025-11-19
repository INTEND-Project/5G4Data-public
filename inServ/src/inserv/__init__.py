from __future__ import annotations

from typing import TYPE_CHECKING

from inserv.config import AppConfig
from inserv.logging_config import configure_logging
from inserv.repositories.intent_repository import IntentRepository
from inserv.repositories.intent_report_repository import IntentReportRepository
from inserv.repositories.hub_subscription_repository import HubSubscriptionRepository
from inserv.services.intent_service import IntentService
from inserv.services.k8s_deployer import KubernetesDeployer
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
    from inserv.health import register_health_blueprint
    config = config or AppConfig.from_env()
    configure_logging(config.log_level)

    connexion_app = connexion.App(__name__, specification_dir="./openapi/")
    connexion_app.add_api(
        "openapi.yaml",
        arguments={"title": "INTEND 5G4DATA use case; Intent Management API"},
        pythonic_params=True,
        validate_responses=True,
        strict_validation=True,
    )

    flask_app = connexion_app.app
    flask_app.config["APP_CONFIG"] = config

    intent_repository = IntentRepository()
    report_repository = IntentReportRepository()
    hub_repository = HubSubscriptionRepository()
    deployer = KubernetesDeployer(config)
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
        reporting_service,
        observation_scheduler,
        graphdb_client=graphdb_client,
        handler_name=config.reporting_handler,
        owner_name=config.reporting_owner,
    )

    register_health_blueprint(flask_app)
    return connexion_app

