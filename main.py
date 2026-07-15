"""Standalone local runner for the ADK agent — no `adk` CLI, no Google Cloud.

Run an interactive chat loop straight from Python:

    python main.py

This uses ADK's Runner with an in-memory session store, so nothing is persisted
and nothing external is required beyond a Gemini API key in `assistant/.env`.
"""

import asyncio
import os

from dotenv import load_dotenv
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Load assistant/.env BEFORE importing the agent, so GOOGLE_API_KEY /
# GOOGLE_GENAI_USE_VERTEXAI / GEMINI_MODEL are set when the agent is built.
_ENV_PATH = os.path.join(os.path.dirname(__file__), "assistant", ".env")
load_dotenv(_ENV_PATH)

from assistant.agent import root_agent  # noqa: E402  (import after load_dotenv)

APP_NAME = "local_assistant"
USER_ID = "local_user"
SESSION_ID = "local_session"


def _check_api_key() -> None:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise SystemExit(
            "No GOOGLE_API_KEY found.\n"
            f"Create {_ENV_PATH} (copy assistant/.env.example) and add your key from\n"
            "https://aistudio.google.com/apikey"
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

    print(f"Chatting with '{root_agent.name}' (model: {root_agent.model}).")
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
