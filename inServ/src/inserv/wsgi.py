from __future__ import annotations

from inserv import create_app
from inserv.config import AppConfig

connexion_app = create_app(AppConfig.from_env())
app = connexion_app.app


