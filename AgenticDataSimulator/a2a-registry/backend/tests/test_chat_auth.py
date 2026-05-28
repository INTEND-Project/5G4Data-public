"""Tests for authenticated Live terminal chat proxy."""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from fastapi.testclient import TestClient

from app.models import AgentPublic, Capabilities

from .conftest import MOCK_AGENT_ROW

MOCK_UUID = "550e8400-e29b-41d4-a716-446655440000"


def _make_agent_public(**overrides):
    caps = json.loads(MOCK_AGENT_ROW["capabilities"])
    defaults = dict(
        id=UUID(MOCK_AGENT_ROW["id"]),
        created_at=datetime.fromisoformat(MOCK_AGENT_ROW["created_at"]),
        updated_at=datetime.fromisoformat(MOCK_AGENT_ROW["updated_at"]),
        hidden=MOCK_AGENT_ROW["hidden"],
        flag_count=MOCK_AGENT_ROW["flag_count"],
        protocolVersion=MOCK_AGENT_ROW["protocol_version"],
        name="demo-agent",
        description=MOCK_AGENT_ROW["description"],
        author=MOCK_AGENT_ROW["author"],
        wellKnownURI="https://host.example/agents/demo-agent/.well-known/agent-card.json",
        url=MOCK_AGENT_ROW["url"],
        version=MOCK_AGENT_ROW["version"],
        provider=None,
        documentationUrl=None,
        capabilities=Capabilities(**caps),
        defaultInputModes=json.loads(MOCK_AGENT_ROW["default_input_modes"]),
        defaultOutputModes=json.loads(MOCK_AGENT_ROW["default_output_modes"]),
        skills=[],
        conformance=None,
        uptime_percentage=100.0,
        avg_response_time_ms=50,
        last_health_check=datetime.fromisoformat("2024-01-01T00:00:00"),
        is_healthy=True,
    )
    defaults.update(overrides)
    return AgentPublic(**defaults)


def test_chat_proxy_passes_agent_api_key_headers(mock_db, monkeypatch):
    monkeypatch.setenv(
        "AGENT_API_KEYS",
        '{"demo-agent":"secret-key"}',
    )
    from app.config import Settings

    monkeypatch.setattr("app.agent_auth.settings", Settings())

    mock_public = _make_agent_public(id=UUID(MOCK_UUID))

    mock_a2a_client = MagicMock()

    async def empty_events():
        if False:
            yield None

    mock_a2a_client.send_message = MagicMock(return_value=empty_events())

    mock_factory = MagicMock()
    mock_factory.create_from_url = AsyncMock(return_value=mock_a2a_client)

    mock_http_client = MagicMock()
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.main.db", mock_db), \
         patch("app.main.run_pending_sql_migrations", new=AsyncMock()), \
         patch("app.main.AgentRepository") as mock_repo, \
         patch("app.main.HealthCheckRepository"), \
         patch("app.main.ClientFactory", return_value=mock_factory), \
         patch("app.main.httpx.AsyncClient", return_value=mock_http_client) as mock_client_cls:
        from app.main import app, limiter

        limiter.reset()
        instance = mock_repo.return_value
        instance.get_by_id = AsyncMock(return_value=mock_public)

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                f"/agents/{MOCK_UUID}/chat",
                json={"message": "hello"},
            )

        limiter.reset()

    assert response.status_code == 200
    mock_client_cls.assert_called_once()
    assert mock_client_cls.call_args.kwargs["headers"] == {"X-Api-Key": "secret-key"}
