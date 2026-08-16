# nono Google ADK demo

This repository demonstrates running a local [Google Agent Development Kit
(ADK)](https://google.github.io/adk-docs/) agent inside a
[nono](https://github.com/nolabs-ai/nono) security sandbox.

![nono Google ADK demo](assets/2026-07-17%2020.56.52.gif)

The demo shows three parts of nono working together:

- **Filesystem isolation:** the agent can access the project directory, but
  paths outside the allow-list are blocked by the operating system.
- **Brokered networking:** model traffic goes through nono's supervised proxy,
  where outbound domains can be allowed or denied.
- **Credential protection:** the real provider API key stays in macOS Keychain.
  The sandbox sees a short-lived phantom credential, which nono replaces with
  the real key only on an approved request to the selected provider API.

The example ADK agent is named `local_assistant` and has tools for telling the
time, evaluating basic arithmetic, listing a folder, and fetching an HTTP URL.

## Prerequisites

- For a native run: `nono` and Python 3.14 or later. The credential setup below
  uses macOS Keychain.
- For a container run: Docker; nono and Python are included in the image.
- An API key from [Google AI Studio](https://aistudio.google.com/apikey), the
  [OpenAI Platform](https://platform.openai.com/api-keys), or the
  [Claude Platform](https://platform.claude.com/settings/keys)

## Setup

Create the virtual environment and install the dependencies:

```bash
python3 -m venv .venv
.venv/bin/python3 -m pip install -r requirements.txt
```

Copy the non-secret agent configuration:

```bash
cp assistant/.env.example assistant/.env
```

Choose a provider and model in `assistant/.env`:

```dotenv
AGENT_PROVIDER=gemini
AGENT_MODEL=gemini-2.5-flash
```

The supported providers use native Google ADK adapters and the providers'
official SDKs—LiteLLM is not installed or used:

| Provider | Default model | Key variable | nono credential | Native source in v0.72 |
| --- | --- | --- | --- | --- |
| Gemini | `gemini-2.5-flash` | `GOOGLE_API_KEY` | `gemini` | Keychain `gemini` |
| OpenAI | `gpt-5.4-mini` | `OPENAI_API_KEY` | `openai` | Keychain `openai` |
| Anthropic | `claude-sonnet-5` | `ANTHROPIC_API_KEY` | `anthropic` | Host environment |

Store the corresponding API key in macOS Keychain. You only need to add the
providers you intend to use:

```bash
# Gemini
security add-generic-password -U -s "nono" -a "gemini" -w

# OpenAI
security add-generic-password -U -s "nono" -a "openai" -w

# Anthropic
security add-generic-password -U -s "nono" -a "anthropic" -w
```

Each command prompts for that provider's API key. Do not put a real key in
`assistant/.env`; this file contains only non-secret provider and model names.
For a native Anthropic run, v0.72's built-in route reads the host environment;
load it from Keychain only for the launch:

```bash
ANTHROPIC_API_KEY="$(security find-generic-password -w -s nono -a anthropic)" \
nono run --profile ./policy.json --allow-cwd --credential anthropic -- \
  .venv/bin/python3 -m uvicorn web_app:app --host 127.0.0.1 --port 8000
```

## Run the web demo

Start the local web server inside nono:

```bash
nono run \
  --profile ./policy.json \
  --allow-cwd \
  --credential gemini \
  -- .venv/bin/python3 -m uvicorn web_app:app --host 127.0.0.1 --port 8000
```

The value passed to `--credential` must match `AGENT_PROVIDER`. For OpenAI, for
example, set `AGENT_PROVIDER=openai` and optionally `AGENT_MODEL=gpt-5.4-mini`
in `assistant/.env`, then launch with:

```bash
nono run \
  --profile ./policy.json \
  --allow-cwd \
  --credential openai \
  -- .venv/bin/python3 -m uvicorn web_app:app --host 127.0.0.1 --port 8000
```

Restart the server after changing the provider or model.

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). The selected provider
and model appear in the header. Each browser tab gets its own in-memory
conversation, and **New chat** starts a fresh one. The web UI
uses the same agent and tools as the terminal demo; only the presentation layer
is different. The server listens on localhost, and port 8000 is explicitly
allowed by `policy.json`.

## Run with Docker

The GitHub workflow publishes multi-platform images to GitHub Container
Registry. The image includes nono, and its entrypoint always launches the web
server as a sandboxed child of `nono run`:

```text
Docker -> nono supervisor -> sandboxed Python/Uvicorn child
             |                         |
             | reads real key          | sees only phantom key
             v                         v
      /run/secrets/provider_api_key   nono's loopback proxy
```

The real key must be available as `/run/secrets/provider_api_key` to the nono
supervisor. It must not be passed with `--env GOOGLE_API_KEY`,
`--env OPENAI_API_KEY`, or `--env ANTHROPIC_API_KEY`.

### Docker Compose

The included `compose.yaml` mounts `PROVIDER_API_KEY_FILE` as a read-only
Compose secret. For OpenAI on macOS, reuse the key stored in Keychain through a
temporary, owner-only file:

```bash
secret_file="$(mktemp "$PWD/.docker-secret.XXXXXX")"
trap 'rm -f "$secret_file"' EXIT
chmod 600 "$secret_file"
security find-generic-password -w -s nono -a openai > "$secret_file"

AGENT_PROVIDER=openai \
AGENT_MODEL=gpt-5.4-mini \
PROVIDER_API_KEY_FILE="$secret_file" \
docker compose up
```

Replace `openai` with `gemini` or `anthropic` and select the matching model when
using another provider. Stop the service with `docker compose down`.

Compose receives only the file path in its host-side environment; it does not
add the key to the container environment. The trusted nono supervisor reads the
secret mount before sandboxing. The Python child gets a session-scoped phantom
value in the provider's normal API-key variable and a base URL pointing at
nono's loopback credential proxy, while Landlock denies it access to the mount.

### Plain `docker run`

Standalone `docker run` has no runtime `--secret` flag, so use a read-only bind
mount from a protected file. This macOS example creates a temporary file in the
project (a path Docker Desktop can share), fills it from Keychain without
putting the key in the command line, and removes it when the shell exits:

```bash
secret_file="$(mktemp "$PWD/.docker-secret.XXXXXX")"
trap 'rm -f "$secret_file"' EXIT
chmod 600 "$secret_file"
security find-generic-password -w -s nono -a openai > "$secret_file"

docker run --rm \
  --publish 127.0.0.1:8000:8000 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --tmpfs /nono-state:rw,noexec,nosuid,size=16m,uid=10001,gid=10001,mode=0700 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=bind,source=$secret_file,target=/run/secrets/provider_api_key,readonly" \
  --env AGENT_PROVIDER=openai \
  --env AGENT_MODEL=gpt-5.4-mini \
  ghcr.io/nolabs-ai/nono-adk-example:latest
```

To build the image locally instead of pulling it:

```bash
docker build --tag nono-adk-example:local .
```

Then replace the GHCR image name in the `docker run` command with
`nono-adk-example:local`.

### Security boundary

`container-policy.json` defines three `file://` credential routes. The
entrypoint activates only the route selected by `AGENT_PROVIDER`; Gemini maps
to `google_gemini` so Google GenAI receives its expected
`GOOGLE_GEMINI_BASE_URL`. nono reads the file before applying Linux Landlock,
denies the child access to `/run/secrets`, and swaps the phantom token for the
real key only when forwarding to the selected provider.

This protects the key from the agent process, its Python tools, and anything it
launches. It does not protect against the Docker host, Docker administrators,
container root, or the trusted nono supervisor: those are outside this threat
boundary and can access the mounted secret. A Docker/Compose secret is still
raw secret material at runtime; the security property is that it never enters
the sandboxed agent's environment or memory. Never put a key in the Dockerfile,
a build argument, or the image.

## Publish the container

`.github/workflows/publish-container.yml` builds Linux AMD64 and ARM64 images:

- Pull requests build the image without publishing it.
- Pushes to `main` publish `latest`, `main`, and a commit tag.
- Tags such as `v1.2.0` publish semantic-version tags.
- Manual runs are available through **Actions → Publish container image**.

The workflow authenticates to `ghcr.io` with the repository's `GITHUB_TOKEN`;
no registry password is required. The first published GHCR package may need to
be made public once in the package settings before unauthenticated users can
pull it.

## Run in the terminal

Run the agent through the ADK terminal:

```bash
nono run \
  --profile ./policy.json \
  --allow-cwd \
  --credential gemini \
  -- .venv/bin/adk run assistant
```

Or run the standalone Python chat loop:

```bash
nono run \
  --profile ./policy.json \
  --allow-cwd \
  --credential gemini \
  -- .venv/bin/python3 main.py
```

`--credential <provider>` loads the route's configured real-key source and
gives the sandbox a phantom credential. In nono v0.72, Gemini and OpenAI use
Keychain while Anthropic uses the host `ANTHROPIC_API_KEY` described above.
`--profile ./policy.json` enables the supervised network proxy, and
`--allow-cwd` grants the agent access to this project directory.

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

The agent can then use the selected provider normally:

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
demo policy allows the provider API endpoints and Google (including the
`www.google.com` redirect target), while explicitly denying `example.com`:

```json
"allow_domain": [
  "google.com",
  "*.google.com",
  "api.openai.com",
  "api.anthropic.com"
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
- `Dockerfile` packages nono and the web interface as a non-root container.
- `container-policy.json` brokers the mounted provider secret and denies the
  sandboxed child access to `/run/secrets`.
- `docker-entrypoint.sh` launches Uvicorn through `nono run`.
- `compose.yaml` mounts the provider key for the nono supervisor.
- `.github/workflows/publish-container.yml` publishes multi-platform GHCR images.
- `assistant/__init__.py` exposes the agent to the `adk` CLI.
