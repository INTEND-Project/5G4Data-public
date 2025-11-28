from __future__ import annotations

from inorch_tmf_proxy import create_app
from inorch_tmf_proxy.config import AppConfig

connexion_app = create_app(AppConfig.from_env())
app = connexion_app.app


