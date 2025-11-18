#!/usr/bin/env python3

from __future__ import annotations

from inserv import create_app
from inserv.config import AppConfig
from inserv import encoder


def main() -> None:
    config = AppConfig.from_env()
    app = create_app(config)
    app.app.json_encoder = encoder.JSONEncoder
    app.run(host=config.host, port=config.port)


if __name__ == "__main__":
    main()
