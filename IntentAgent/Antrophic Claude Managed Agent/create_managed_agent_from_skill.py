#!/usr/bin/env python3
"""Create a Claude Managed Agent from a local SKILL.md file."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import httpx
from anthropic import Anthropic

DEFAULT_SYSTEM_PROMPT = """You are a TM Forum intent authoring agent for 5G4Data.

Behavior rules:
- Do not narrate your internal steps or planning.
- Do not provide progress updates such as "I will..." or "Let me...".
- Keep outputs concise and task-focused.

Output policy:
1) If information is sufficient, return only the final Turtle intent.
2) If critical information is missing, ask at most 2 concise clarifying questions and stop.
3) Do not repeat prior context unless explicitly requested.
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Upload SKILL.md as a custom skill and create a Claude Managed Agent "
            "that uses that skill."
        )
    )
    parser.add_argument(
        "--skill-file",
        default="SKILL.md",
        help="Path to the skill markdown file (default: SKILL.md).",
    )
    parser.add_argument(
        "--agent-name",
        default="TMF Intent Authoring Agent",
        help="Human-readable managed agent name (used for create, optional for update).",
    )
    parser.add_argument(
        "--agent-description",
        default="Managed agent seeded with the local TM Forum intent authoring skill.",
        help="Managed agent description (used for create, optional for update).",
    )
    parser.add_argument(
        "--agent-id",
        default=None,
        help="Existing agent ID to update in place. If omitted, creates a new agent.",
    )
    parser.add_argument(
        "--model",
        default="claude-sonnet-4-5",
        help="Claude model for the managed agent (default: claude-sonnet-4-5).",
    )
    parser.add_argument(
        "--display-title",
        default="TMF Intent Authoring",
        help="Display title for the uploaded custom skill.",
    )
    parser.add_argument(
        "--upload-root",
        default=None,
        help=(
            "Top-level folder name used in multipart upload paths. "
            "Defaults to the frontmatter 'name' field from SKILL.md."
        ),
    )
    parser.add_argument(
        "--system-prompt",
        default=None,
        help=(
            "System prompt string to enforce response style. "
            "If omitted, the built-in concise intent-authoring prompt is used."
        ),
    )
    parser.add_argument(
        "--system-prompt-file",
        default=None,
        help=(
            "Path to a file containing system prompt text. "
            "If set, this overrides --system-prompt."
        ),
    )
    return parser.parse_args()


def infer_skill_name_from_frontmatter(skill_path: Path) -> str:
    content = skill_path.read_text(encoding="utf-8")
    match = re.search(r"(?ms)^---\s*\n(.*?)\n---\s*\n", content)
    if not match:
        raise ValueError("SKILL.md is missing YAML frontmatter with a 'name' field.")

    frontmatter = match.group(1)
    name_match = re.search(r"(?m)^\s*name\s*:\s*([^\n]+?)\s*$", frontmatter)
    if not name_match:
        raise ValueError("SKILL.md frontmatter is missing required 'name' field.")

    skill_name = name_match.group(1).strip().strip("'\"")
    if not skill_name:
        raise ValueError("SKILL.md frontmatter 'name' cannot be empty.")
    return skill_name


def create_or_version_skill(
    client: Anthropic,
    api_key: str,
    skill_path: Path,
    upload_path: str,
    display_title: str,
) -> dict:
    with skill_path.open("rb") as skill_fh:
        response = httpx.post(
            "https://api.anthropic.com/v1/skills?beta=true",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "skills-2025-10-02",
            },
            data={"display_title": display_title},
            files=[("files[]", (upload_path, skill_fh, "text/markdown"))],
            timeout=60.0,
        )

    if response.status_code < 400:
        created = response.json()
        return {"id": created["id"], "latest_version": created["latest_version"]}

    error_text = response.text
    if "Skill cannot reuse an existing display_title" not in error_text:
        raise RuntimeError(f"Skill upload failed with {response.status_code}: {error_text}")

    existing_skill_id = None
    skills_page = client.beta.skills.list(source="custom", limit=100)
    for existing in skills_page.data:
        if getattr(existing, "display_title", None) == display_title:
            existing_skill_id = existing.id
            break
    if not existing_skill_id:
        raise RuntimeError(
            "Skill already exists with this display_title, but no matching custom skill "
            f"was found in list results: {display_title}"
        )

    with skill_path.open("rb") as skill_fh:
        version_response = httpx.post(
            f"https://api.anthropic.com/v1/skills/{existing_skill_id}/versions?beta=true",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "skills-2025-10-02",
            },
            files=[("files[]", (upload_path, skill_fh, "text/markdown"))],
            timeout=60.0,
        )

    if version_response.status_code >= 400:
        raise RuntimeError(
            "Skill version upload failed with "
            f"{version_response.status_code}: {version_response.text}"
        )

    created_version = version_response.json()
    return {"id": existing_skill_id, "latest_version": created_version["version"]}


def resolve_system_prompt(args: argparse.Namespace) -> str:
    if args.system_prompt_file:
        path = Path(args.system_prompt_file).resolve()
        if not path.exists():
            raise FileNotFoundError(f"System prompt file not found: {path}")
        return path.read_text(encoding="utf-8").strip()
    if args.system_prompt:
        return args.system_prompt.strip()
    return DEFAULT_SYSTEM_PROMPT.strip()


def main() -> None:
    args = parse_args()
    skill_path = Path(args.skill_file).resolve()

    if not skill_path.exists():
        raise FileNotFoundError(f"Skill file not found: {skill_path}")

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError("Set ANTHROPIC_API_KEY before running this script.")

    upload_root = args.upload_root or infer_skill_name_from_frontmatter(skill_path)
    upload_path = f"{upload_root}/SKILL.md"
    system_prompt = resolve_system_prompt(args)
    client = Anthropic(api_key=api_key)

    skill = create_or_version_skill(
        client=client,
        api_key=api_key,
        skill_path=skill_path,
        upload_path=upload_path,
        display_title=args.display_title,
    )

    skill_ref = {
        "type": "custom",
        "skill_id": skill["id"],
        "version": skill["latest_version"],
    }

    toolset = [
        {
            "type": "agent_toolset_20260401",
            "default_config": {
                "enabled": True,
                "permission_policy": {"type": "always_allow"},
            },
            "configs": [
                {
                    "name": "read",
                    "enabled": True,
                    "permission_policy": {"type": "always_allow"},
                }
            ],
        }
    ]

    if args.agent_id:
        current = client.beta.agents.retrieve(args.agent_id)
        update_payload = {
            "version": current.version,
            "model": args.model,
            "skills": [skill_ref],
            "tools": toolset,
            "system": system_prompt,
        }
        if args.agent_name:
            update_payload["name"] = args.agent_name
        if args.agent_description:
            update_payload["description"] = args.agent_description
        agent = client.beta.agents.update(args.agent_id, **update_payload)
    else:
        agent = client.beta.agents.create(
            model=args.model,
            name=args.agent_name,
            description=args.agent_description,
            skills=[skill_ref],
            tools=toolset,
            system=system_prompt,
        )

    print(
        json.dumps(
            {
                "skill_id": skill["id"],
                "skill_version": skill["latest_version"],
                "agent_id": agent.id,
                "agent_version": agent.version,
                "agent_name": agent.name,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
