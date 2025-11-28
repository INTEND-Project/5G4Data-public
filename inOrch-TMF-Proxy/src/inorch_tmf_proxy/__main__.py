#!/usr/bin/env python3

from __future__ import annotations

from inorch_tmf_proxy import create_app
from inorch_tmf_proxy.config import AppConfig
from inorch_tmf_proxy import encoder


def main() -> None:
    config = AppConfig.from_env()
    app = create_app(config)
    app.app.json_encoder = encoder.JSONEncoder
    app.run(host=config.host, port=config.port)


if __name__ == "__main__":
    main()
