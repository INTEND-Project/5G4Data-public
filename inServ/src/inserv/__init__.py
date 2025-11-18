from __future__ import annotations

import connexion

from inserv.config import AppConfig
from inserv.health import register_health_blueprint
from inserv.logging_config import configure_logging
from inserv.repositories.intent_repository import IntentRepository
from inserv.services.intent_service import IntentService
from inserv.services.k8s_deployer import KubernetesDeployer


def create_app(config: AppConfig | None = None) -> connexion.App:
    """Create and configure the Connexion application instance."""
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

    repository = IntentRepository()
    deployer = KubernetesDeployer(config)
    flask_app.config["INTENT_SERVICE"] = IntentService(repository, deployer)

    register_health_blueprint(flask_app)
    return connexion_app

