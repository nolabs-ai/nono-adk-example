"""Local web interface for the ADK demo agent.

Run with:

    uvicorn web_app:app --host 127.0.0.1 --port 8000

The server deliberately binds to localhost in the documented command. Each
browser tab gets an independent in-memory ADK session, just like starting a
fresh terminal chat.
"""

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
ENV_PATH = BASE_DIR / "assistant" / ".env"

# Load credentials before importing the agent: its model is selected at import
# time from GEMINI_MODEL.
load_dotenv(ENV_PATH)

from assistant.agent import root_agent  # noqa: E402


APP_NAME = "local_assistant"
USER_ID = "web_user"
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    """A single message in one browser conversation."""

    session_id: uuid.UUID
    message: str = Field(min_length=1, max_length=20_000)


class ChatResponse(BaseModel):
    reply: str


class SessionResponse(BaseModel):
    session_id: uuid.UUID


class AgentRuntime:
    """Own the ADK runner and isolate concurrent browser conversations."""

    def __init__(self) -> None:
        self.sessions = InMemorySessionService()
        self.runner = Runner(
            agent=root_agent,
            app_name=APP_NAME,
            session_service=self.sessions,
        )
        self._known_sessions: set[str] = set()
        self._session_locks: dict[str, asyncio.Lock] = {}
        self._registry_lock = asyncio.Lock()

    async def ensure_session(self, session_id: str) -> None:
        async with self._registry_lock:
            if session_id in self._known_sessions:
                return
            await self.sessions.create_session(
                app_name=APP_NAME,
                user_id=USER_ID,
                session_id=session_id,
            )
            self._known_sessions.add(session_id)
            self._session_locks[session_id] = asyncio.Lock()

    async def create_session(self) -> str:
        session_id = str(uuid.uuid4())
        await self.ensure_session(session_id)
        return session_id

    async def respond(self, session_id: str, text: str) -> str:
        await self.ensure_session(session_id)
        message = types.Content(role="user", parts=[types.Part(text=text)])
        replies: list[str] = []

        # ADK sessions are ordered conversations. Prevent two quick submissions
        # from interleaving events within the same session.
        async with self._session_locks[session_id]:
            async for event in self.runner.run_async(
                user_id=USER_ID,
                session_id=session_id,
                new_message=message,
            ):
                if event.is_final_response() and event.content:
                    reply = "".join(
                        part.text or "" for part in (event.content.parts or [])
                    ).strip()
                    if reply:
                        replies.append(reply)

        if not replies:
            raise RuntimeError("The agent completed without a text response")
        return "\n\n".join(replies)


def _check_api_key() -> None:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError(
            f"No GOOGLE_API_KEY found. Configure {ENV_PATH} or launch with "
            "`nono --credential gemini` as described in the README."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _check_api_key()
    app.state.runtime = AgentRuntime()
    yield


app = FastAPI(
    title="nono ADK demo",
    description="A local browser chat for the sandboxed Google ADK agent.",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/agent")
async def agent_info() -> dict[str, str]:
    return {
        "name": root_agent.name,
        "model": str(root_agent.model),
    }


@app.post("/api/sessions", response_model=SessionResponse)
async def create_session(request: Request) -> SessionResponse:
    session_id = await request.app.state.runtime.create_session()
    return SessionResponse(session_id=session_id)


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be blank.")

    try:
        reply = await request.app.state.runtime.respond(
            str(payload.session_id), message
        )
    except Exception as exc:
        # Keep credentials and provider internals out of browser-visible errors.
        logger.exception("Agent request failed for session %s", payload.session_id)
        raise HTTPException(
            status_code=502,
            detail="The agent could not complete that request. Check the server log.",
        ) from exc
    return ChatResponse(reply=reply)
