from __future__ import annotations

import sys
from inserv import create_app
from inserv.config import AppConfig

if __name__ == "__main__":
    config = AppConfig.from_env()
    app = create_app(config)
    app.run(port=config.port, host=config.host, debug=False)
