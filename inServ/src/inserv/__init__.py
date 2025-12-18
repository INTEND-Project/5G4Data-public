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
    from flask import Response, request, jsonify
    from inserv.health import register_health_blueprint
    from inserv.utils import tail_log_file
    config = config or AppConfig.from_env()
    configure_logging(config.log_level, getattr(config, "log_file_path", None))

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
        # Skip logging for /logs endpoint to avoid log noise
        if request.path == "/logs":
            return
        logger.info(f"Request: {request.method} {request.path}")
        if request.is_json:
            try:
                logger.debug(f"Request body: {request.get_json()}")
            except Exception as e:
                logger.warning(f"Failed to parse request body: {e}")
    
    @flask_app.after_request
    def log_response_info(response):
        # Skip logging for /logs endpoint to avoid log noise
        if request.path == "/logs":
            return response
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
    intent_router = IntentRouter(
        infrastructure_service=infrastructure_service,
        test_mode=getattr(config, "test_mode", False),
        innet_base_url=getattr(config, "innet_base_url", "http://intend.eu/inNet"),
    )

    flask_app.config["INFRASTRUCTURE_SERVICE"] = infrastructure_service
    flask_app.config["INTENT_ROUTER"] = intent_router

    register_health_blueprint(flask_app)

    # Optional /logs endpoint for browsing recent application logs.
    if getattr(config, "enable_log_endpoint", False):

        @flask_app.route("/logs")
        def view_logs():
            """Return recent log output as a simple auto-refreshing HTML page.

            Intended for use on trusted/local networks only.
            """
            max_bytes_param = request.args.get("max_bytes", type=int)
            max_bytes = (
                max_bytes_param
                if max_bytes_param is not None and 1024 <= max_bytes_param <= 1024 * 1024
                else 256 * 1024
            )

            refresh_seconds = request.args.get("refresh", default=2, type=int)
            if refresh_seconds <= 0 or refresh_seconds > 60:
                refresh_seconds = 2

            log_path = getattr(config, "log_file_path", "logs/inserv.log")
            content = tail_log_file(log_path, max_bytes=max_bytes)

            # Basic HTML escaping for log content
            escaped = (
                content.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )

            html = f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>inServ logs</title>
    <meta http-equiv="refresh" content="{refresh_seconds}">
    <style>
      body {{ font-family: monospace; margin: 0; padding: 0; background: #111; color: #eee; }}
      pre {{ white-space: pre-wrap; word-wrap: break-word; padding: 1rem; margin: 0; }}
    </style>
    <script>
      // Prevent browser from restoring scroll position
      if ('scrollRestoration' in history) {{
        history.scrollRestoration = 'manual';
      }}
      // Scroll to bottom on page load/refresh
      function scrollToBottom() {{
        const anchor = document.getElementById('bottom-anchor');
        if (anchor) {{
          anchor.scrollIntoView({{ behavior: 'auto', block: 'end' }});
        }}
        // Also try direct scrolling as fallback
        requestAnimationFrame(function() {{
          const maxHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          );
          window.scrollTo(0, maxHeight);
        }});
      }}
      // Scroll after DOM is ready and after load
      if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', scrollToBottom);
      }} else {{
        scrollToBottom();
      }}
      window.addEventListener('load', scrollToBottom);
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(scrollToBottom);
      // Multiple timeouts to ensure it works even with slow rendering
      setTimeout(scrollToBottom, 50);
      setTimeout(scrollToBottom, 200);
      setTimeout(scrollToBottom, 500);
    </script>
  </head>
  <body>
    <pre>{escaped}</pre>
    <div id="bottom-anchor"></div>
  </body>
</html>
"""
            return Response(html, mimetype="text/html")

    return connexion_app
