from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _maybe_path(value: str | None) -> Path | None:
    if not value:
        return None
    return Path(value).expanduser().resolve()


def _normalized_base_url(value: str | None, default: str) -> str:
    if value is None:
        return default
    stripped = value.strip()
    return stripped or default


@dataclass(slots=True)
class AppConfig:
    debug: bool
    llm_provider: str
    openai_api_key: str
    openai_model: str
    openai_base_url: str | None
    anthropic_api_key: str
    anthropic_model: str
    anthropic_base_url: str | None
    host: str
    port: int
    workload_catalog_base_url: str
    graphdb_endpoint: str
    graphdb_named_graph: str
    graphdb_query_limit: int
    graphdb_context_limit: int
    default_intent_handler: str
    default_intent_owner: str
    auto_generate_description: bool
    ontology_root: Path | None
    example_intents_root: Path | None
    skill_file: Path
    system_prompt_file: Path
    llm_log_path: Path | None

    @classmethod
    def from_env(cls, llm_log_path: Path | None = None) -> "AppConfig":
        project_root = Path(__file__).resolve().parents[2]
        load_dotenv(project_root / ".env", override=False)

        llm_provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
        openai_api_key = os.getenv("OPENAI_API_KEY", "")
        anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if llm_provider == "openai" and not openai_api_key:
            raise EnvironmentError("Set OPENAI_API_KEY when LLM_PROVIDER=openai.")
        if llm_provider == "anthropic" and not anthropic_api_key:
            raise EnvironmentError("Set ANTHROPIC_API_KEY when LLM_PROVIDER=anthropic.")
        if llm_provider not in {"openai", "anthropic"}:
            raise EnvironmentError("LLM_PROVIDER must be either 'openai' or 'anthropic'.")

        intent_agent_root = Path(__file__).resolve().parents[3]
        default_skill = intent_agent_root / "Antrophic Claude Managed Agent" / "SKILL.md"
        default_system = intent_agent_root / "Antrophic Claude Managed Agent" / "SYSTEM_PROMPT.md"

        env_llm_log = _maybe_path(os.getenv("STANDALONE_AGENT_LLM_LOG"))
        resolved_llm_log = llm_log_path or env_llm_log

        return cls(
            debug=os.getenv("STANDALONE_AGENT_DEBUG", "false").strip().lower() in {"1", "true", "yes", "on"},
            llm_provider=llm_provider,
            openai_api_key=openai_api_key,
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            openai_base_url=_normalized_base_url(
                os.getenv("OPENAI_BASE_URL"),
                "https://api.openai.com/v1",
            ),
            anthropic_api_key=anthropic_api_key,
            anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest"),
            anthropic_base_url=_normalized_base_url(
                os.getenv("ANTHROPIC_BASE_URL"),
                "https://api.anthropic.com",
            ),
            host=os.getenv("STANDALONE_AGENT_HOST", "127.0.0.1"),
            port=int(os.getenv("STANDALONE_AGENT_PORT", "8010")),
            workload_catalog_base_url=os.getenv(
                "WORKLOAD_CATALOG_BASE_URL",
                "https://start5g-1.cs.uit.no/wchartmuseum",
            ).rstrip("/"),
            graphdb_endpoint=os.getenv(
                "GRAPHDB_ENDPOINT",
                "https://start5g-1.cs.uit.no/graphdb/repositories/intents_and_intent_reports",
            ),
            graphdb_named_graph=os.getenv(
                "GRAPHDB_NAMED_GRAPH",
                "http://intendproject.eu/telenor/infra",
            ),
            graphdb_query_limit=max(1, int(os.getenv("GRAPHDB_QUERY_LIMIT", "50"))),
            graphdb_context_limit=max(1, int(os.getenv("GRAPHDB_CONTEXT_LIMIT", "10"))),
            default_intent_handler=os.getenv("DEFAULT_INTENT_HANDLER", "inServ"),
            default_intent_owner=os.getenv("DEFAULT_INTENT_OWNER", "inChat"),
            auto_generate_description=os.getenv("AUTO_GENERATE_DESCRIPTION", "true").strip().lower()
            in {"1", "true", "yes", "on"},
            ontology_root=_maybe_path(os.getenv("ONTOLOGY_ROOT")),
            example_intents_root=_maybe_path(os.getenv("EXAMPLE_INTENTS_ROOT")),
            skill_file=_maybe_path(os.getenv("SKILL_FILE")) or default_skill,
            system_prompt_file=_maybe_path(os.getenv("SYSTEM_PROMPT_FILE")) or default_system,
            llm_log_path=resolved_llm_log,
        )
