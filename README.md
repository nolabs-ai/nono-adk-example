# adkdemo — a local Google ADK agent (Gemini API, no Google Cloud)

A minimal [Google Agent Development Kit (ADK)](https://google.github.io/adk-docs/)
agent that runs **entirely locally** against the **Gemini API**. It uses a free
Google AI Studio API key — **no Google Cloud project, no Vertex AI, no billing
setup required**.

The agent (`local_assistant`) ships with four example tools:

- `get_current_time` — current time for any IANA timezone
- `calculate` — safe basic arithmetic
- `roll_dice` — roll N dice with S sides
- `list_folder` — list files and subfolders in a directory

## Project layout

```
adkdemo/
├── assistant/
│   ├── __init__.py        # exposes the agent to the ADK CLI
│   ├── agent.py           # defines root_agent + its tools
│   ├── .env.example       # template for your API key
│   └── .env               # (you create this — gitignored)
├── main.py                # standalone runner: `python main.py`
├── requirements.txt
└── README.md
```

## Setup

1. **Create a virtual environment and install dependencies:**

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Get a free Gemini API key** from Google AI Studio (no cloud project needed):
   <https://aistudio.google.com/apikey>

3. **Add your key:**

   ```bash
   cp assistant/.env.example assistant/.env
   # then edit assistant/.env and paste your key into GOOGLE_API_KEY
   ```

   The important line is `GOOGLE_GENAI_USE_VERTEXAI=FALSE` — that is what tells
   ADK to use the Gemini API directly instead of Vertex AI / Google Cloud.

## Run it

You have three ways to run the same agent — all local:

**A) Standalone Python script (simplest):**

```bash
python main.py
```

**B) ADK terminal chat:**

```bash
adk run assistant
```

**C) ADK web UI** (opens a local chat interface at http://localhost:8000):

```bash
adk web
```

Then pick `assistant` from the dropdown.

## Try asking

- "What time is it in Tokyo?"
- "What's (17 * 23) + 100?"
- "Roll 3 six-sided dice."
- "What's in my current folder?" or "List the files in ~/Downloads."

## Running under the nono sandbox

The `list_folder` tool is sandbox-aware. If it hits a permission error
(`EPERM`/`EACCES`) while running inside a nono security sandbox — detected via
the `NONO_CAP_FILE` environment variable — it
returns a `"sandbox": "nono"` flag and a `message_for_user`, and the agent is
instructed to tell you the path is outside the sandbox's allow-list instead of
silently retrying. To grant access, restart the session with the path allowed
(`nono run --allow <path> -- <command>`) or diagnose it with
`nono why --path <path> --op read`.

Outside a nono sandbox, a permission error is reported as an ordinary
"Permission denied" without the sandbox hint.

## Customising

- **Swap the model:** set `GEMINI_MODEL` in `assistant/.env`
  (e.g. `gemini-2.5-pro`, `gemini-2.0-flash`).
- **Add a tool:** write a plain Python function with a clear docstring and type
  hints in `assistant/agent.py`, then add it to the `tools=[...]` list.
- **Change behaviour:** edit the `instruction` string on `root_agent`.
