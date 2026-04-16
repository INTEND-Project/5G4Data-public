from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


Role = Literal["user", "assistant"]


@dataclass(slots=True)
class ChatMessage:
    role: Role
    text: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass(slots=True)
class ChatSession:
    session_id: str = field(default_factory=lambda: f"session_{uuid4().hex}")
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    messages: list[ChatMessage] = field(default_factory=list)


class SessionCreateResponse(BaseModel):
    session_id: str
    created_at: datetime


class MessageRequest(BaseModel):
    text: str = Field(min_length=1)
    debug: bool = False


class MessageResponse(BaseModel):
    session_id: str
    response: str
    warnings: list[str] = Field(default_factory=list)
    debug: list[str] = Field(default_factory=list)


class SessionResponse(BaseModel):
    session_id: str
    created_at: datetime
    message_count: int
