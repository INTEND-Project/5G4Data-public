from __future__ import annotations

from flask import Blueprint, current_app, jsonify


def register_health_blueprint(app) -> None:
    """Expose /healthz for Kubernetes probes."""
    health = Blueprint("health", __name__)

    @health.get("/healthz")
    def healthz():
        config = current_app.config.get("APP_CONFIG")
        payload = {
            "status": "ok",
            "service": "inServ",
        }
        return jsonify(payload), 200

    app.register_blueprint(health)
