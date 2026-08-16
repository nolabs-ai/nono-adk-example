# syntax=docker/dockerfile:1

ARG NONO_VERSION=v0.72.0

FROM debian:bookworm-slim AS nono

ARG NONO_VERSION
ARG TARGETARCH

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/nono

RUN case "$TARGETARCH" in \
      amd64) nono_arch=x86_64 ;; \
      arm64) nono_arch=aarch64 ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    asset="nono-${NONO_VERSION}-${nono_arch}-unknown-linux-gnu.tar.gz" && \
    release_url="https://github.com/nolabs-ai/nono/releases/download/${NONO_VERSION}" && \
    curl -fsSLO "${release_url}/${asset}" && \
    curl -fsSLO "${release_url}/SHA256SUMS.txt" && \
    awk -v asset="$asset" '$2 == asset { print }' SHA256SUMS.txt > SHA256SUMS.selected && \
    test -s SHA256SUMS.selected && \
    sha256sum --check SHA256SUMS.selected && \
    tar -xzf "$asset" && \
    install -m 0755 nono /usr/local/bin/nono

FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/app \
    NONO_NO_UPDATE_CHECK=1 \
    XDG_STATE_HOME=/nono-state

WORKDIR /app

RUN groupadd --gid 10001 app && \
    useradd --uid 10001 --gid app --create-home --home-dir /home/app \
      --shell /usr/sbin/nologin app

COPY --from=nono /usr/local/bin/nono /usr/local/bin/nono

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY assistant/__init__.py assistant/agent.py ./assistant/
COPY web ./web
COPY web_app.py ./
COPY container-policy.json /etc/nono/container-policy.json
COPY --chmod=0555 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/agent', timeout=2)"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "web_app:app", "--host", "0.0.0.0", "--port", "8000"]
