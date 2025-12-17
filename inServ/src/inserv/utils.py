from __future__ import annotations

from pathlib import Path


def tail_log_file(path: str, max_bytes: int = 256 * 1024) -> str:
    """Return up to the last ``max_bytes`` of the log file at ``path``.

    This reads from the end of the file backwards to avoid loading very large
    files fully into memory.
    """
    log_path = Path(path)
    if not log_path.is_file():
        return f"Log file not found: {log_path}"

    max_bytes = max(1024, max_bytes)  # enforce a small sensible minimum

    size = log_path.stat().st_size
    if size <= max_bytes:
        return log_path.read_text(errors="replace")

    with log_path.open("rb") as f:
        f.seek(-max_bytes, 2)  # seek from end
        data = f.read()

    # Try to decode as UTF-8, replacing invalid sequences.
    return data.decode("utf-8", errors="replace")

