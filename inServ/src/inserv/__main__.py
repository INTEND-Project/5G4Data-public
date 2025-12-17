from __future__ import annotations

import argparse

from inserv import create_app
from inserv.config import AppConfig


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the inServ Intent Management API service.",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help=(
            "Enable test mode. In this mode, inServ will not forward intents to "
            "the inOrch-TMF-Proxy but will only log that they were received."
        ),
    )
    return parser


if __name__ == "__main__":
    parser = _build_arg_parser()
    args = parser.parse_args()

    config = AppConfig.from_env()
    if getattr(args, "test", False):
        config.test_mode = True

    app = create_app(config)
    app.run(port=config.port, host=config.host, debug=False)
