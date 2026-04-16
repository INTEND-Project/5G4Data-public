from __future__ import annotations

from fastapi import FastAPI, HTTPException

from standalone_python_agent.agent import AgentCore
from standalone_python_agent.config import AppConfig
from standalone_python_agent.models import (
    ChatSession,
    MessageRequest,
    MessageResponse,
    SessionCreateResponse,
    SessionResponse,
)


def create_app(config: AppConfig | None = None) -> FastAPI:
    app_config = config or AppConfig.from_env()
    agent = AgentCore(app_config)
    sessions: dict[str, ChatSession] = {}

    app = FastAPI(title="StandalonePythonAgent", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/sessions", response_model=SessionCreateResponse)
    def create_session() -> SessionCreateResponse:
        session = ChatSession()
        sessions[session.session_id] = session
        return SessionCreateResponse(
            session_id=session.session_id,
            created_at=session.created_at,
        )

    @app.get("/sessions/{session_id}", response_model=SessionResponse)
    def get_session(session_id: str) -> SessionResponse:
        session = sessions.get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return SessionResponse(
            session_id=session.session_id,
            created_at=session.created_at,
            message_count=len(session.messages),
        )

    @app.post("/sessions/{session_id}/messages", response_model=MessageResponse)
    def send_message(session_id: str, request: MessageRequest) -> MessageResponse:
        session = sessions.get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        try:
            result = agent.run_turn(session, request.text)
        except Exception as exc:  # noqa: BLE001
            # Surface the actual upstream LLM error to the caller.
            # Avoid returning stack traces; the CLI will show this message.
            raise HTTPException(status_code=502, detail=str(exc))
        return MessageResponse(
            session_id=session_id,
            response=result.response,
            warnings=result.warnings,
            debug=result.debug if (app_config.debug or request.debug) else [],
        )

    return app
