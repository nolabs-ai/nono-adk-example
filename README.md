# nono Google ADK demo

This repository demonstrates running a local [Google Agent Development Kit
(ADK)](https://google.github.io/adk-docs/) agent inside a
[nono](https://github.com/nolabs-ai/nono) security sandbox.

![nono Google ADK demo](assets/2026-07-17%2020.56.52.gif)

The demo shows three parts of nono working together:

- **Filesystem isolation:** the agent can access the project directory, but
  paths outside the allow-list are blocked by the operating system.
- **Brokered networking:** Gemini traffic goes through nono's supervised proxy,
  where outbound domains can be allowed or denied.
- **Credential protection:** the real Gemini API key stays in macOS Keychain.
  The sandbox sees a short-lived phantom credential, which nono replaces with
  the real key only on an approved request to the Gemini API.

The example ADK agent is named `local_assistant` and has tools for telling the
time, evaluating basic arithmetic, listing a folder, and fetching an HTTP URL.

## Prerequisites

- macOS
- `nono`
- Python and `uv`
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

Create and activate the virtual environment, then install the dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Store the Gemini key in macOS Keychain under nono's `gemini` credential
account:

```bash
security add-generic-password -U -s "nono" -a "gemini" -w
```

Enter the Gemini API key when prompted. Do not put the real key in
`assistant/.env`.

## Run the web demo

Start the local web server inside nono:

```bash
nono run \
  --profile ./policy.json \
  --allow-cwd \
  --credential gemini \
  -- .venv/bin/python3 -m uvicorn web_app:app --host 127.0.0.1 --port 8000
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). Each browser tab gets
its own in-memory conversation, and **New chat** starts a fresh one. The web UI
uses the same agent and tools as the terminal demo; only the presentation layer
is different. The server listens on localhost, and port 8000 is explicitly
allowed by `policy.json`.

## Run in the terminal

Run the agent through the ADK terminal:

```bash
nono run --profile ./policy.json --allow-cwd --credential gemini -- adk run assistant
```

Or run the standalone Python chat loop:

```bash
nono run \
  --profile ./policy.json \
  --allow-cwd \
  --credential gemini \
  -- .venv/bin/python3 main.py
```

`--credential gemini` loads the real key from Keychain and gives the sandbox a
phantom credential. `--profile ./policy.json` enables the supervised network
proxy, and `--allow-cwd` grants the agent access to this project directory.

At startup, nono prints the effective capabilities before applying the sandbox:

```text
nono v0.68.0
Capabilities:
────────────────────────────────────────────────────
 r+w  /Users/lukehinds/.cache/uv (dir)
 r+w  /Users/lukehinds/dev/nono-workspace/adkdemo (dir)
     + 42 system/group paths (-v to show)
 net  proxy
────────────────────────────────────────────────────

mode supervised (proxy, supervisor)
Applying sandbox...
```

The agent can then use Gemini normally:

```text
Running agent local_assistant, type exit to exit.
[user]: hello
[local_assistant]: Hello! How can I help you today?
```

## Prove the filesystem sandbox

Ask the agent to read a directory that was not granted:

```text
you> list files in ~/Documents

assistant> Access to `/Users/lukehinds/Documents` is blocked by corporate
policy. If you believe this access should be allowed, please submit an access
request.
```

This denial is enforced by nono at the OS boundary. The agent cannot retry its
way around it. To deliberately grant that directory on the next run, add:

```bash
--allow "$HOME/Documents"
```

To inspect the policy decision without granting access:

```bash
nono why --path "$HOME/Documents" --op read
```

## Prove the network sandbox

The agent's `fetch_url` tool makes HTTP requests from inside the sandbox. The
demo policy allows Google (including the `www.google.com` redirect target) and
explicitly denies `example.com`:

```json
"allow_domain": [
  "google.com",
  "*.google.com"
],
"deny_domain": ["example.com"]
```

Ask the agent to fetch one denied domain and one allowed domain:

```text
[user]: fetch https://example.com

[local_assistant]: Access to `https://example.com` is blocked by corporate
policy. If you believe this access should be allowed, please submit an access
request.

[user]: fetch https://google.com

[local_assistant]: I successfully fetched https://www.google.com/ (HTTP 200,
text/html).
```

For `example.com`, nono's supervised proxy returns:

```text
403 Forbidden: host example.com is in the deny list
```

`fetch_url` recognizes that denial and returns a structured `"sandbox":
"nono"` result to the model. The real network request is rejected by the proxy;
the agent cannot retry around the rule. The same tool follows the allowed
`google.com` redirect and receives a normal `200 OK` response from
`www.google.com`.

## What is in the demo?

- `policy.json` defines the nono sandbox and supervised network policy.
- `assistant/agent.py` defines the ADK agent and its filesystem and HTTP tools.
- `main.py` provides a standalone interactive runner.
- `web_app.py` exposes the agent through a small FastAPI JSON API.
- `web/` contains the browser chat interface.
- `assistant/__init__.py` exposes the agent to the `adk` CLI.
