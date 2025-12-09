from __future__ import annotations

from typing import TYPE_CHECKING

from inserv.config import AppConfig
from inserv.logging_config import configure_logging
from inserv.services.infrastructure_service import InfrastructureService
from inserv.services.intent_router import IntentRouter

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
        arguments={"title": "INTEND 5G4DATA use case; Intent Management API (inServ)"},
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

    # Initialize GraphDB client
    graphdb_client = (
        GraphDbClient(
            base_url=config.graphdb_base_url,
            repository=config.graphdb_repository,
        )
        if config.enable_graphdb and GraphDbClient is not None
        else None
    )

    # Initialize services
    infrastructure_service = InfrastructureService(
        graphdb_client=graphdb_client,
        base_url=config.datacenter_base_url,
        port_base=config.datacenter_port_base,
    )
    intent_router = IntentRouter(infrastructure_service)

    flask_app.config["INFRASTRUCTURE_SERVICE"] = infrastructure_service
    flask_app.config["INTENT_ROUTER"] = intent_router

    register_health_blueprint(flask_app)
    return connexion_app
