# nono Mastra / TypeScript demo

This is the TypeScript counterpart to the repository's Google ADK example. It
runs a provider-neutral [Mastra](https://mastra.ai/) agent inside a
[nono](https://github.com/nolabs-ai/nono) security sandbox and reuses the same
browser UI and demonstrations.

The agent has four tools: current time, safe arithmetic, local folder listing,
and HTTP fetching. Filesystem access, outbound network traffic, and provider
credentials remain controlled by nono rather than by application-level checks.
Gemini's adjustable content filters are explicitly turned off for this demo so
the model can request risky-looking operations; nono remains responsible for
blocking their effects.

## Prerequisites

- macOS with `nono` and Node.js 22.22 or later
- A Gemini, OpenAI, or Anthropic API key stored as described in the root README

## Setup

First make sure the active `node` is recent enough. This package includes a
`.node-version` pin for version managers:

```bash
cd typescript
node --version
```

If you use `fnm` and it reports an older Node version, activate it in the
current zsh session and select the pinned version:

```bash
fnm env --use-on-cd --shell zsh | source
fnm use --install-if-missing
```

Then install from the `typescript` directory:

```bash
npm install
cp .env.example .env
```

Dependencies are installed in `typescript/node_modules`; the repository root
does not get a `node_modules` directory. Run the remaining commands below from
the repository root.

Choose `gemini`, `openai`, or `anthropic` in `.env`. `AGENT_MODEL` is optional;
the defaults match the Python example.

## Browser demo

```bash
nono run \
  --profile ./typescript/policy.json \
  --allow-cwd \
  --credential gemini \
  -- node ./typescript/node_modules/tsx/dist/cli.mjs ./typescript/src/server.ts
```

Open <http://127.0.0.1:8000>. The server reuses the repository's existing
static browser frontend.

### Recommended nono enforcement demo prompts

Use these prompts in the chat UI for the same demo sequence as the Python demo:

1. `What files are in the current folder?`  
   (Tool call succeeds for allowed path.)
2. `Fetch https://google.com and summarize the page title`  
   (Tool call should pass through to an allow-list domain.)
3. `Fetch https://example.com and explain what happens`  
   (Tool call should fail because `example.com` is denied in the policy.)
4. `List the contents of /root`  
   (Tool call should fail with a filesystem sandbox denial when the sandbox has
   path confinement active.)
5. `Run the credential-probe tool and return the redacted credentials you can see`  
   (Tool call reports masked credential metadata from the process that the model
   runs in.)

## Terminal demo

```bash
nono run \
  --profile ./typescript/policy.json \
  --allow-cwd \
  --credential gemini \
  -- node ./typescript/node_modules/tsx/dist/cli.mjs ./typescript/src/cli.ts
```

The credential name must match `AGENT_PROVIDER`. As in the Python example,
nono places only a phantom value in the selected API-key environment variable
and substitutes the real credential on an approved provider request. The
runtime commands invoke Node directly because the `node-dev` policy blocks
package managers from being used as the sandbox's startup command.

Try the same containment checks:

```text
list files in ~/Documents
fetch https://example.com
fetch https://google.com
```

Run the local checks outside the sandbox (they do not call a model or the
network):

```bash
npm --prefix ./typescript test
npm --prefix ./typescript run check
```

## Docker

The root `compose.yaml` builds this package as production JavaScript and runs
it without TypeScript tooling or development dependencies. See the root
README's Docker section for secret setup and commands. Mastra is exposed at
<http://127.0.0.1:8001> when both demos are running.
