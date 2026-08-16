"""Standalone local runner for the multi-provider ADK agent.

Run an interactive chat loop straight from Python:

    python main.py

This uses ADK's Runner with an in-memory session store, so nothing is persisted
and nothing external is required beyond a provider API credential.
"""

import asyncio
import os

from dotenv import load_dotenv
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Load assistant/.env before importing the agent so its provider and model are
# selected when the agent is built.
_ENV_PATH = os.path.join(os.path.dirname(__file__), "assistant", ".env")
load_dotenv(_ENV_PATH)

from assistant.agent import AGENT_MODEL  # noqa: E402  (import after load_dotenv)
from assistant.agent import AGENT_PROVIDER  # noqa: E402
from assistant.agent import API_KEY_ENV  # noqa: E402
from assistant.agent import provider_api_key_is_available  # noqa: E402
from assistant.agent import root_agent  # noqa: E402

APP_NAME = "local_assistant"
USER_ID = "local_user"
SESSION_ID = "local_session"


def _check_api_key() -> None:
    if not provider_api_key_is_available():
        raise SystemExit(
            f"No {API_KEY_ENV} found for provider {AGENT_PROVIDER!r}.\n"
            f"Launch nono with `--credential {AGENT_PROVIDER}` as described "
            "in the README; nono will inject a phantom value."
        )


async def _respond(runner: Runner, text: str) -> None:
    """Send one user message and stream the agent's reply to stdout."""
    message = types.Content(role="user", parts=[types.Part(text=text)])
    async for event in runner.run_async(
        user_id=USER_ID, session_id=SESSION_ID, new_message=message
    ):
        if event.is_final_response() and event.content and event.content.parts:
            reply = "".join(part.text or "" for part in event.content.parts)
            print(f"\nassistant> {reply.strip()}\n")


async def main() -> None:
    _check_api_key()

    session_service = InMemorySessionService()
    await session_service.create_session(
        app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID
    )
    runner = Runner(
        agent=root_agent, app_name=APP_NAME, session_service=session_service
    )

    print(
        f"Chatting with '{root_agent.name}' "
        f"(provider: {AGENT_PROVIDER}, model: {AGENT_MODEL})."
    )
    print("Type your message. Use 'exit' or Ctrl-D to quit.\n")

    while True:
        try:
            user_input = input("you> ").strip()
        except EOFError:
            print()
            break
        if user_input.lower() in {"exit", "quit"}:
            break
        if not user_input:
            continue
        await _respond(runner, user_input)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nBye!")
