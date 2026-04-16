from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _serialize_sdk_object(obj: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    model_dump = getattr(obj, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(mode="json")
        except TypeError:
            return model_dump()
    to_dict = getattr(obj, "dict", None)
    if callable(to_dict):
        return to_dict()
    return repr(obj)


def _assistant_text_from_response(response: Any) -> str | None:
    choices = getattr(response, "choices", None)
    if choices:
        try:
            msg = choices[0].message
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                return content
        except (IndexError, AttributeError):
            pass
    parts: list[str] = []
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", "") == "text":
            parts.append(getattr(block, "text", "") or "")
    joined = "".join(parts).strip()
    return joined or None


class LLMTranscriptLogger:
    """Append-only JSONL log of LLM requests and responses (thread-safe)."""

    def __init__(self, path: Path) -> None:
        self.path = path.expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def append(self, phase: str, request: dict[str, Any], response: Any) -> None:
        entry: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "phase": phase,
            "request": request,
            "response": _serialize_sdk_object(response),
        }
        assistant_text = _assistant_text_from_response(response)
        if assistant_text is not None:
            entry["assistant_text"] = assistant_text
        line = json.dumps(entry, ensure_ascii=False, default=str)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
