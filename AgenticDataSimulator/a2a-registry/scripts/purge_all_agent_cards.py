#!/usr/bin/env python3
"""
Permanently delete all agent cards from the registry database.

This bypasses the API soft-delete behavior and performs a hard delete
(`DELETE FROM agents`), which also removes dependent health checks and flags
through foreign key cascade rules.

Usage:
    # Recommended (uses backend settings/env)
    cd backend && uv run python ../scripts/purge_all_agent_cards.py --yes

    # Explicit database URL
    cd backend && uv run python ../scripts/purge_all_agent_cards.py \
      --database-url postgresql://user:pass@localhost:5432/a2a_registry --yes
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import asyncpg

# Allow importing backend app settings when run from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.config import settings  # noqa: E402


async def count_table(conn: asyncpg.Connection, table: str) -> int:
    return int(await conn.fetchval(f"SELECT COUNT(*) FROM {table}"))


def resolve_database_url(cli_value: str | None) -> str:
    if cli_value:
        return cli_value

    # Support both backend settings and common env names.
    if settings.database_url:
        return settings.database_url

    env_url = os.environ.get("DATABASE_URL")
    if env_url:
        return env_url

    raise RuntimeError(
        "No database URL available. Provide --database-url or set backend DB env vars."
    )


async def purge_all_agents(database_url: str, assume_yes: bool) -> int:
    conn = await asyncpg.connect(database_url)
    try:
        agents_total = await count_table(conn, "agents")
        agents_hidden = int(
            await conn.fetchval("SELECT COUNT(*) FROM agents WHERE hidden = true")
        )
        health_checks = await count_table(conn, "health_checks")
        flags = await count_table(conn, "agent_flags")

        print("Current registry data:")
        print(f"  agents_total:   {agents_total}")
        print(f"  agents_hidden:  {agents_hidden}")
        print(f"  health_checks:  {health_checks}")
        print(f"  agent_flags:    {flags}")

        if agents_total == 0:
            print("\nNo agents found. Nothing to delete.")
            return 0

        if not assume_yes:
            print(
                "\nRefusing to delete without explicit confirmation.\n"
                "Re-run with --yes to permanently delete all agent cards."
            )
            return 2

        print("\nDeleting all agent rows permanently...")
        async with conn.transaction():
            result = await conn.execute("DELETE FROM agents")
            # asyncpg returns e.g. "DELETE 4"
            deleted = int(result.split()[-1])

        remaining_agents = await count_table(conn, "agents")
        remaining_checks = await count_table(conn, "health_checks")
        remaining_flags = await count_table(conn, "agent_flags")

        print("Delete completed.")
        print(f"  deleted_agents: {deleted}")
        print(f"  remaining_agents: {remaining_agents}")
        print(f"  remaining_health_checks: {remaining_checks}")
        print(f"  remaining_agent_flags: {remaining_flags}")
        return 0
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Permanently delete all agent cards from registry DB."
    )
    parser.add_argument(
        "--database-url",
        help="PostgreSQL connection URL. If omitted, backend settings/env are used.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Required to execute deletion.",
    )
    args = parser.parse_args()

    try:
        database_url = resolve_database_url(args.database_url)
        exit_code = asyncio.run(purge_all_agents(database_url, args.yes))
        sys.exit(exit_code)
    except Exception as exc:
        print(f"Error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()

