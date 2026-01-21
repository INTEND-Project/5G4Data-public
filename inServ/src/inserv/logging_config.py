from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler


def configure_logging(level: str = "INFO", log_file_path: str | None = None) -> None:
    """Configure application-wide logging.

    If ``log_file_path`` is provided, logs are written both to stdout and to the
    specified rotating log file. Otherwise, logs go only to stdout.
    """
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]

    if log_file_path:
        # Ensure parent directory exists
        try:
            os.makedirs(os.path.dirname(log_file_path) or ".", exist_ok=True)
        except Exception:
            # Fall back silently if directory creation fails; stdout logging still works.
            pass

        file_handler = RotatingFileHandler(
            log_file_path,
            maxBytes=5 * 1024 * 1024,  # 5 MB
            backupCount=3,
        )
        file_handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")
        )
        handlers.append(file_handler)

    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=handlers,
    )

    # Suppress noisy connexion warnings about multiple content types
    logging.getLogger("connexion.operations.openapi3").setLevel(logging.ERROR)
