"""Apply ordered SQL migrations from migrations/versions (docker-compose / existing DBs).

Compose only runs scripts in docker-entrypoint-initdb.d on first volume init, so later
migrations must be applied explicitly. This module mirrors the Helm migration job logic.
"""

from __future__ import annotations

import os
from pathlib import Path

import asyncpg

from .config import settings

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations" / "versions"

# Serialize migration runs when API and worker start together.
_ADVISORY_LOCK_KEY = 884_293_711


def _skip_migrations() -> bool:
    raw = os.getenv("SKIP_SQL_MIGRATIONS", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _benign_migration_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "already exists" in msg or "duplicate" in msg


async def run_pending_sql_migrations() -> None:
    """Create schema_migrations, then apply each *.sql once (idempotent where possible)."""
    if _skip_migrations():
        return
    if not MIGRATIONS_DIR.is_dir():
        return

    conn = await asyncpg.connect(settings.database_url)
    try:
        await conn.execute("SELECT pg_advisory_lock($1)", _ADVISORY_LOCK_KEY)
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )

        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            filename = path.name
            applied = await conn.fetchval(
                "SELECT 1 FROM schema_migrations WHERE filename = $1",
                filename,
            )
            if applied:
                continue

            sql = path.read_text(encoding="utf8").strip()
            if not sql:
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)",
                    filename,
                )
                continue

            try:
                await conn.execute(sql)
            except Exception as exc:
                if _benign_migration_error(exc):
                    pass
                else:
                    raise

            await conn.execute(
                "INSERT INTO schema_migrations (filename) VALUES ($1)",
                filename,
            )
            print(f"✅ Applied migration {filename}")
    finally:
        try:
            await conn.execute("SELECT pg_advisory_unlock($1)", _ADVISORY_LOCK_KEY)
        except Exception:
            pass
        await conn.close()
