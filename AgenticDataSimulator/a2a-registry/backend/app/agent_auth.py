"""Resolve agent API keys for outbound registry requests."""

from __future__ import annotations

import json
from typing import Optional
from urllib.parse import urlparse

from .config import settings


def _parse_agent_api_keys(raw: str) -> dict[str, str]:
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    result: dict[str, str] = {}
    for key, value in parsed.items():
        if isinstance(key, str) and isinstance(value, str) and value.strip():
            result[key] = value.strip()
    return result


def agent_slug_from_well_known_uri(well_known_uri: str) -> Optional[str]:
    try:
        pathname = urlparse(well_known_uri).path
    except Exception:
        return None
    marker = "/.well-known/"
    index = pathname.find(marker)
    if index <= 0:
        return None
    prefix = pathname[:index]
    segments = [segment for segment in prefix.split("/") if segment]
    return segments[-1] if segments else None


def resolve_agent_api_key(
    well_known_uri: str,
    agent_card_name: Optional[str] = None,
) -> Optional[str]:
    keys = _parse_agent_api_keys(settings.agent_api_keys)
    if agent_card_name and agent_card_name in keys:
        return keys[agent_card_name]
    slug = agent_slug_from_well_known_uri(well_known_uri)
    if slug and slug in keys:
        return keys[slug]
    fallback = settings.agent_api_key.strip()
    return fallback or None


def build_agent_auth_headers(
    well_known_uri: str,
    agent_card_name: Optional[str] = None,
) -> dict[str, str]:
    api_key = resolve_agent_api_key(well_known_uri, agent_card_name)
    if not api_key:
        return {}
    return {settings.agent_api_key_header: api_key}
