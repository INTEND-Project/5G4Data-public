from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn

from standalone_python_agent.api import create_app
from standalone_python_agent.config import AppConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Standalone Python Agent API (FastAPI + uvicorn).")
    parser.add_argument(
        "--logLLM",
        nargs="?",
        const="llm-interactions.log",
        metavar="FILE",
        help="Append full LLM prompts and raw responses to FILE (JSON lines). "
        "Default FILE: llm-interactions.log in the current working directory.",
    )
    args = parser.parse_args()
    llm_log = Path(args.logLLM).expanduser().resolve() if args.logLLM else None
    config = AppConfig.from_env(llm_log_path=llm_log)
    app = create_app(config)
    uvicorn.run(app, host=config.host, port=config.port)


if __name__ == "__main__":
    main()
