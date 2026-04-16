from __future__ import annotations

import argparse
import sys

import httpx


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Chat with the StandalonePythonAgent API.")
    parser.add_argument("--api-base-url", default="http://127.0.0.1:8010")
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--prompt", default=None)
    parser.add_argument("--debug", action="store_true", help="Print debug trace from API responses.")
    return parser.parse_args()


def create_session(base_url: str) -> str:
    response = httpx.post(f"{base_url}/sessions", timeout=30.0)
    response.raise_for_status()
    return response.json()["session_id"]


def send_message(base_url: str, session_id: str, text: str) -> dict:
    response = httpx.post(
        f"{base_url}/sessions/{session_id}/messages",
        json={"text": text, "debug": False},
        timeout=300.0,
    )
    if response.status_code >= 400:
        # Keep error details readable for interactive use.
        raise RuntimeError(f"HTTP {response.status_code}: {response.text}")
    return response.json()


def send_message_with_debug(base_url: str, session_id: str, text: str, debug: bool) -> dict:
    response = httpx.post(
        f"{base_url}/sessions/{session_id}/messages",
        json={"text": text, "debug": debug},
        timeout=300.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text}")
    return response.json()


def main() -> None:
    args = parse_args()
    base_url = args.api_base_url.rstrip("/")
    session_id = args.session_id or create_session(base_url)

    print(f"Session: {session_id}")

    if args.prompt:
        payload = send_message_with_debug(base_url, session_id, args.prompt, args.debug)
        print("\nAssistant:\n" + payload["response"] + "\n")
        warnings = payload.get("warnings", [])
        if warnings:
            print("Warnings:")
            for warning in warnings:
                print(f"- {warning}")
        if args.debug:
            debug = payload.get("debug", [])
            if debug:
                print("Debug:")
                for entry in debug:
                    print(f"- {entry}")
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

        try:
            payload = send_message_with_debug(base_url, session_id, user_input, args.debug)
        except Exception as exc:  # noqa: BLE001
            print(f"Error: {exc}", file=sys.stderr)
            continue

        print("\nAssistant:\n" + payload["response"] + "\n")
        warnings = payload.get("warnings", [])
        if warnings:
            print("Warnings:")
            for warning in warnings:
                print(f"- {warning}")
        if args.debug:
            debug = payload.get("debug", [])
            if debug:
                print("Debug:")
                for entry in debug:
                    print(f"- {entry}")


if __name__ == "__main__":
    main()
