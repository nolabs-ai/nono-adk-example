#!/bin/sh
set -eu

provider="${AGENT_PROVIDER:-gemini}"

case "$provider" in
  gemini|google)
    credential="google_gemini"
    ;;
  openai|anthropic)
    credential="$provider"
    ;;
  *)
    echo "Unsupported AGENT_PROVIDER '$provider'; use gemini, openai, or anthropic." >&2
    exit 64
    ;;
esac

# nono runs as the container's unprivileged user. It reads the mounted secret
# before applying Landlock, then gives the child only a phantom credential and
# a loopback proxy URL. The child has no filesystem grant for /run/secrets.
exec nono run \
  --silent \
  --startup-timeout 0 \
  --profile /etc/nono/container-policy.json \
  --allow-cwd \
  --credential "$credential" \
  -- "$@"
