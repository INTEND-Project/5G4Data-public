#!/usr/bin/env python3
"""Chat with a Claude Managed Agent via Sessions API."""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Optional

from anthropic import Anthropic

RATE_LIMIT_PROFILES = {
    "free-tier-safe": {
        "poll_interval_seconds": 15.0,
        "turn_timeout_seconds": 240.0,
        "inter_turn_delay_seconds": 15.0,
        "retry_delays_seconds": [20.0, 40.0, 80.0],
    },
    "free-tier-balanced": {
        "poll_interval_seconds": 10.0,
        "turn_timeout_seconds": 180.0,
        "inter_turn_delay_seconds": 10.0,
        "retry_delays_seconds": [15.0, 30.0, 60.0],
    },
    "faster-risky": {
        "poll_interval_seconds": 5.0,
        "turn_timeout_seconds": 150.0,
        "inter_turn_delay_seconds": 5.0,
        "retry_delays_seconds": [10.0, 20.0, 40.0],
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Send prompts to a Claude Managed Agent using sessions/events."
    )
    parser.add_argument(
        "--agent-id",
        required=True,
        help="Managed agent ID (e.g. agent_...).",
    )
    parser.add_argument(
        "--environment-id",
        default=None,
        help="Existing environment ID. If omitted, the script finds/creates one by name.",
    )
    parser.add_argument(
        "--environment-name",
        default="intent-agent-default-env",
        help="Environment name to find or create when --environment-id is omitted.",
    )
    parser.add_argument(
        "--github-repo-url",
        default="https://github.com/arne-munch-ellingsen/INTEND-repo-for-TM-Forum-Intent-Toolkit",
        help="Private GitHub repo URL to mount into the session.",
    )
    parser.add_argument(
        "--github-repo-branch",
        default="main",
        help="Branch to checkout for the mounted GitHub repository.",
    )
    parser.add_argument(
        "--github-mount-path",
        default="/workspace/5G4Data-private",
        help="Mount path in session container for the GitHub repository.",
    )
    parser.add_argument(
        "--no-github-resource",
        action="store_true",
        help="Disable mounting the private GitHub repository resource.",
    )
    parser.add_argument(
        "--prompt",
        default=None,
        help="One-shot prompt. If omitted, starts interactive chat loop.",
    )
    parser.add_argument(
        "--rate-limit-profile",
        choices=list(RATE_LIMIT_PROFILES.keys()) + ["custom"],
        default="free-tier-safe",
        help=(
            "Preset matrix for polling/timeout/retries. "
            "Use 'custom' with explicit flags to override everything."
        ),
    )
    parser.add_argument(
        "--poll-interval-seconds",
        type=float,
        default=None,
        help="Polling interval while waiting for agent response (overrides profile).",
    )
    parser.add_argument(
        "--turn-timeout-seconds",
        type=float,
        default=None,
        help="Maximum seconds to wait for one agent turn (overrides profile).",
    )
    parser.add_argument(
        "--inter-turn-delay-seconds",
        type=float,
        default=None,
        help="Delay after each turn before next user input (overrides profile).",
    )
    return parser.parse_args()


def require_api_key() -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError("Set ANTHROPIC_API_KEY before running this script.")
    return api_key


def get_or_create_environment_id(client: Anthropic, env_id: Optional[str], env_name: str) -> str:
    if env_id:
        return env_id

    page = client.beta.environments.list(limit=100, include_archived=False)
    for env in page.data:
        if getattr(env, "name", None) == env_name:
            return env.id

    created = client.beta.environments.create(
        name=env_name,
        description="Auto-created by chat_with_managed_agent.py",
    )
    return created.id


def build_session_resources(args: argparse.Namespace) -> list[dict]:
    if args.no_github_resource:
        return []

    github_token = os.getenv("GITHUB_TOKEN")
    if not github_token:
        raise EnvironmentError(
            "GITHUB_TOKEN is required to mount the private ontology repository. "
            "Set GITHUB_TOKEN or pass --no-github-resource."
        )

    return [
        {
            "type": "github_repository",
            "url": args.github_repo_url,
            "authorization_token": github_token,
            "checkout": {"type": "branch", "name": args.github_repo_branch},
            "mount_path": args.github_mount_path,
        }
    ]


def resolve_runtime_config(args: argparse.Namespace) -> dict:
    if args.rate_limit_profile == "custom":
        default_custom = {
            "poll_interval_seconds": 10.0,
            "turn_timeout_seconds": 180.0,
            "inter_turn_delay_seconds": 10.0,
            "retry_delays_seconds": [15.0, 30.0, 60.0],
        }
        profile = default_custom
    else:
        profile = RATE_LIMIT_PROFILES[args.rate_limit_profile]

    config = {
        "poll_interval_seconds": (
            args.poll_interval_seconds
            if args.poll_interval_seconds is not None
            else profile["poll_interval_seconds"]
        ),
        "turn_timeout_seconds": (
            args.turn_timeout_seconds
            if args.turn_timeout_seconds is not None
            else profile["turn_timeout_seconds"]
        ),
        "inter_turn_delay_seconds": (
            args.inter_turn_delay_seconds
            if args.inter_turn_delay_seconds is not None
            else profile["inter_turn_delay_seconds"]
        ),
        "retry_delays_seconds": list(profile["retry_delays_seconds"]),
    }
    return config


def send_user_message(client: Anthropic, session_id: str, text: str) -> None:
    client.beta.sessions.events.send(
        session_id=session_id,
        events=[
            {
                "type": "user.message",
                "content": [{"type": "text", "text": text}],
            }
        ],
    )


def process_new_events(events: list, seen_event_ids: set[str]) -> tuple[bool, bool, bool]:
    idle_or_terminated = False
    saw_progress = False
    rate_limited = False

    for event in events:
        event_id = getattr(event, "id", None)
        if event_id in seen_event_ids:
            continue
        if event_id:
            seen_event_ids.add(event_id)

        event_type = getattr(event, "type", "")
        if event_type == "agent.message":
            saw_progress = True
            blocks = getattr(event, "content", []) or []
            text_chunks = [getattr(block, "text", "") for block in blocks if getattr(block, "text", "")]
            if text_chunks:
                print("\nAssistant:\n" + "\n".join(text_chunks) + "\n")
        elif event_type == "session.error":
            error_obj = getattr(event, "error", None)
            error_type = getattr(error_obj, "type", "")
            if error_type == "model_rate_limited_error":
                print(
                    "\nAssistant:\n"
                    "The model is temporarily rate limited. "
                    "No extra message will be sent automatically.\n"
                )
                rate_limited = True
            else:
                raise RuntimeError(f"Session error event: {event}")
        elif event_type in {"session.status_idle", "session.status_terminated"}:
            idle_or_terminated = True

    return idle_or_terminated, saw_progress, rate_limited


def await_and_print_agent_turn(
    client: Anthropic,
    session_id: str,
    poll_interval_seconds: float,
    turn_timeout_seconds: float,
    seen_event_ids: set[str],
) -> str:
    start_time = time.time()
    deadline = start_time + turn_timeout_seconds
    max_deadline = start_time + (turn_timeout_seconds * 3)

    while time.time() < deadline and time.time() < max_deadline:
        events_page = client.beta.sessions.events.list(
            session_id=session_id,
            order="asc",
            limit=200,
        )
        idle_or_terminated, saw_progress, rate_limited = process_new_events(
            events_page.data,
            seen_event_ids,
        )

        if saw_progress:
            # Agent is still producing output; extend the waiting window.
            deadline = min(max_deadline, time.time() + turn_timeout_seconds)

        if rate_limited:
            return "rate_limited"

        if idle_or_terminated:
            return "completed"

        time.sleep(poll_interval_seconds)

    raise TimeoutError(
        "Timed out waiting for agent response. The agent produced partial output but did not "
        "reach an idle/terminated state in time."
    )


def send_and_await_with_backoff(
    client: Anthropic,
    session_id: str,
    text: str,
    poll_interval_seconds: float,
    turn_timeout_seconds: float,
    retry_delays_seconds: list[float],
    seen_event_ids: set[str],
) -> bool:
    send_user_message(client, session_id, text)
    outcome = await_and_print_agent_turn(
        client,
        session_id,
        poll_interval_seconds,
        turn_timeout_seconds,
        seen_event_ids,
    )
    if outcome == "completed":
        return True

    for idx, delay in enumerate(retry_delays_seconds, start=1):
        print(
            f"Rate limit cooldown "
            f"(attempt {idx}/{len(retry_delays_seconds)}), waiting {delay:.0f}s..."
        )
        time.sleep(delay)
        events_page = client.beta.sessions.events.list(
            session_id=session_id,
            order="asc",
            limit=200,
        )
        idle_or_terminated, saw_progress, rate_limited = process_new_events(
            events_page.data,
            seen_event_ids,
        )
        if saw_progress:
            outcome = await_and_print_agent_turn(
                client,
                session_id,
                poll_interval_seconds,
                turn_timeout_seconds,
                seen_event_ids,
            )
            if outcome == "completed":
                return True
        elif idle_or_terminated and not rate_limited:
            return True
        if not rate_limited:
            break

    print("Turn still rate-limited after cooldown. Please retry manually in a minute.")
    return False


def main() -> None:
    args = parse_args()
    runtime_config = resolve_runtime_config(args)
    api_key = require_api_key()
    client = Anthropic(api_key=api_key)

    environment_id = get_or_create_environment_id(client, args.environment_id, args.environment_name)
    resources = build_session_resources(args)
    session = client.beta.sessions.create(
        agent=args.agent_id,
        environment_id=environment_id,
        title="IntentAgent chat session",
        resources=resources,
    )
    seen_event_ids: set[str] = set()

    print(f"Session created: {session.id}")
    print(f"Environment: {environment_id}")
    print(
        "Rate-limit profile: "
        f"{args.rate_limit_profile} "
        f"(poll={runtime_config['poll_interval_seconds']}s, "
        f"turn-timeout={runtime_config['turn_timeout_seconds']}s, "
        f"inter-turn-delay={runtime_config['inter_turn_delay_seconds']}s, "
        f"retries={len(runtime_config['retry_delays_seconds'])})"
    )

    if args.prompt:
        send_and_await_with_backoff(
            client,
            session.id,
            args.prompt,
            runtime_config["poll_interval_seconds"],
            runtime_config["turn_timeout_seconds"],
            runtime_config["retry_delays_seconds"],
            seen_event_ids,
        )
        return

    print("Interactive mode. Type 'exit' or 'quit' to stop.")
    while True:
        try:
            user_input = input("You> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            return

        if not user_input:
            continue
        if user_input.lower() in {"exit", "quit"}:
            print("Exiting.")
            return

        send_and_await_with_backoff(
            client,
            session.id,
            user_input,
            runtime_config["poll_interval_seconds"],
            runtime_config["turn_timeout_seconds"],
            runtime_config["retry_delays_seconds"],
            seen_event_ids,
        )
        if runtime_config["inter_turn_delay_seconds"] > 0:
            time.sleep(runtime_config["inter_turn_delay_seconds"])


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pylint: disable=broad-except
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
