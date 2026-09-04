# nono Mastra / TypeScript demo

This is the TypeScript counterpart to the repository's Google ADK example. It
runs a provider-neutral [Mastra](https://mastra.ai/) agent inside a
[nono](https://github.com/nolabs-ai/nono) security sandbox and reuses the same
browser UI and demonstrations.

The agent has four tools: current time, safe arithmetic, local folder listing,
and HTTP fetching. Filesystem access, outbound network traffic, and provider
credentials remain controlled by nono rather than by application-level checks.

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
