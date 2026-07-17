"""A minimal Google ADK agent that runs locally against the Gemini API.

This agent does NOT require Google Cloud / Vertex AI. It talks straight to the
Gemini API using a Google AI Studio API key. The switch that controls this lives
in `assistant/.env`:

    GOOGLE_GENAI_USE_VERTEXAI=FALSE   # use the Gemini API (no GCP needed)
    GOOGLE_API_KEY=<your key>         # from https://aistudio.google.com/apikey

ADK exposes `root_agent` (this module's `root_agent`) to the `adk` CLI tools.
"""

import ast
import datetime
import operator
import os
import stat
import zoneinfo

from google.adk.agents import Agent


# --- Tools -----------------------------------------------------------------
# ADK turns plain Python functions into tools the model can call. The docstring
# and type hints are sent to the model, so keep them clear and accurate.


def get_current_time(timezone: str = "UTC") -> dict:
    """Return the current date and time for an IANA timezone.

    Args:
        timezone: An IANA timezone name, e.g. "UTC", "Europe/London",
            "America/New_York". Defaults to "UTC".

    Returns:
        A dict with the resolved timezone and an ISO-8601 timestamp, or an
        "error" key if the timezone name is not recognised.
    """
    try:
        tz = zoneinfo.ZoneInfo(timezone)
    except Exception:
        return {
            "status": "error",
            "error": f"Unknown timezone: {timezone!r}. Use an IANA name like 'Europe/London'.",
        }
    now = datetime.datetime.now(tz)
    return {
        "status": "ok",
        "timezone": timezone,
        "datetime": now.isoformat(),
        "human_readable": now.strftime("%A, %d %B %Y at %H:%M:%S %Z"),
    }


# A tiny safe arithmetic evaluator so `calculate` never runs arbitrary code.
_ALLOWED_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_ALLOWED_UNARYOPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_BINOPS:
        return _ALLOWED_BINOPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _ALLOWED_UNARYOPS:
        return _ALLOWED_UNARYOPS[type(node.op)](_eval_node(node.operand))
    raise ValueError("Unsupported expression")


def calculate(expression: str) -> dict:
    """Safely evaluate a basic arithmetic expression.

    Supports + - * / // % ** and parentheses over numeric literals only.

    Args:
        expression: e.g. "2 + 2 * 10" or "(3 ** 4) / 9".

    Returns:
        A dict with the numeric "result", or an "error" key on invalid input.
    """
    try:
        tree = ast.parse(expression, mode="eval")
        result = _eval_node(tree.body)
    except Exception:
        return {
            "status": "error",
            "error": f"Could not evaluate {expression!r}. Use numbers and + - * / // % ** ( ).",
        }
    return {"status": "ok", "expression": expression, "result": result}


def _in_nono_sandbox() -> bool:
    """True if we appear to be running inside a nono security sandbox.

    nono launches sandboxed processes with NONO_CAP_FILE pointing at the active
    capability list, so its presence is a reliable in-sandbox signal.
    """
    return bool(os.environ.get("NONO_CAP_FILE"))


def _permission_denied(path: str, resolved: str, exc: OSError) -> dict:
    """Build an error dict for a permission denial (EPERM / EACCES).

    Inside a nono sandbox the denial is a kernel-enforced restriction that cannot
    be worked around from within the session, so we flag it with "sandbox":
    "nono" and hand the model a plain-language message to relay to the user.
    """
    result = {
        "status": "error",
        "error": f"Permission denied: {path!r}",
        "errno": exc.errno,
    }
    if _in_nono_sandbox():
        result["sandbox"] = "nono"
        result["message_for_user"] = (
            "This folder is outside the nono security sandbox's allow-list. nono "
            "enforces this at the OS level, so it cannot be bypassed from inside "
            "the session — do not retry. To grant access, the user can restart "
            f"with `nono run --allow {resolved} -- <command>`, or run "
            f"`nono why --path {resolved} --op read` to see exactly why it was "
            "blocked."
        )
    return result


def list_folder(path: str = ".") -> dict:
    """List the files and subfolders in a directory.

    Args:
        path: Directory to list. Defaults to the current working directory (".").
            A leading "~" is expanded to the user's home directory.

    Returns:
        A dict with the resolved absolute "path", a "count", and "entries" — each
        entry has "name", "type" ("dir" or "file"), and "size_bytes" (None for
        directories). On failure, returns an "error" key; permission denials also
        carry "sandbox": "nono" and a "message_for_user" when running inside a
        nono sandbox.
    """
    expanded = os.path.expanduser(path)
    resolved = os.path.abspath(expanded)

    # Use os.stat directly rather than os.path.exists, which swallows permission
    # errors and reports them as "not found". A sandbox-blocked path must surface
    # as a real permission denial, not a false "does not exist".
    try:
        info = os.stat(expanded)
    except FileNotFoundError:
        return {"status": "error", "error": f"Path does not exist: {path!r}"}
    except PermissionError as exc:
        return _permission_denied(path, resolved, exc)
    except OSError as exc:
        return {"status": "error", "error": f"Could not access {path!r}: {exc.strerror or exc}"}

    if not stat.S_ISDIR(info.st_mode):
        return {"status": "error", "error": f"Not a directory: {path!r}"}

    entries = []
    try:
        with os.scandir(expanded) as it:
            for entry in it:
                is_file = entry.is_file()
                size = None
                if is_file:
                    try:
                        size = entry.stat().st_size
                    except OSError:
                        size = None
                entries.append(
                    {
                        "name": entry.name,
                        "type": "file" if is_file else "dir",
                        "size_bytes": size,
                    }
                )
    except PermissionError as exc:
        return _permission_denied(path, resolved, exc)

    # Directories first, then files, each alphabetically (case-insensitive).
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return {
        "status": "ok",
        "path": resolved,
        "count": len(entries),
        "entries": entries,
    }


# --- Agent -----------------------------------------------------------------

root_agent = Agent(
    # The model is read from GEMINI_MODEL if set, so you can swap it without
    # editing code. Any Gemini API model id works, e.g. gemini-2.5-flash,
    # gemini-2.5-pro, gemini-2.0-flash.
    model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    name="local_assistant",
    description=(
        "A helpful local assistant that can tell the time, do arithmetic, and "
        "list the contents of folders on the local machine."
    ),
    instruction=(
        "You are a friendly, concise assistant running locally on the user's machine. "
        "When the user asks something a tool can answer (the current time, arithmetic, "
        "listing a folder's contents), call the appropriate tool rather "
        "than guessing. When listing a folder, present the results readably (e.g. "
        "directories first, then files). "
        "Summarise tool results in plain language. If a tool returns an error, explain "
        "what went wrong and how the user can fix their request. "
        'If a tool result contains \'"sandbox": "nono"\', tell the user plainly that '
        "you are running inside a nono security sandbox and the requested path is "
        'outside its allow-list, then relay the guidance in "message_for_user". Do '
        "not retry the operation or attempt workarounds."
    ),
    tools=[get_current_time, calculate, list_folder],
)
