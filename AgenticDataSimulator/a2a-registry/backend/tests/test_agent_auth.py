"""Tests for agent API key resolution."""

from app.agent_auth import (
    agent_slug_from_well_known_uri,
    build_agent_auth_headers,
    resolve_agent_api_key,
)


def test_agent_slug_from_well_known_uri():
    uri = "https://host.example/agents/demo-agent/.well-known/agent-card.json"
    assert agent_slug_from_well_known_uri(uri) == "demo-agent"


def test_resolve_agent_api_key_by_name(monkeypatch):
    monkeypatch.setenv(
        "AGENT_API_KEYS",
        '{"demo-agent":"secret-key"}',
    )
    from app.config import Settings

    monkeypatch.setattr("app.agent_auth.settings", Settings())
    assert (
        resolve_agent_api_key(
            "https://host.example/agents/demo-agent/.well-known/agent-card.json",
            "demo-agent",
        )
        == "secret-key"
    )


def test_build_agent_auth_headers(monkeypatch):
    monkeypatch.setenv(
        "AGENT_API_KEYS",
        '{"demo-agent":"secret-key"}',
    )
    from app.config import Settings

    monkeypatch.setattr("app.agent_auth.settings", Settings())
    assert build_agent_auth_headers(
        "https://host.example/agents/demo-agent/.well-known/agent-card.json",
        "demo-agent",
    ) == {"X-Api-Key": "secret-key"}
