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

FROM node:24-bookworm-slim AS build

WORKDIR /build

COPY typescript/package.json typescript/package-lock.json typescript/.npmrc ./
RUN npm ci

COPY typescript/tsconfig.json typescript/tsconfig.build.json ./
COPY typescript/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOME=/home/app \
    HOST=0.0.0.0 \
    PORT=8000 \
    WEB_DIR=/app/web \
    MASTRA_TELEMETRY_DISABLED=1 \
    NONO_NO_UPDATE_CHECK=1 \
    XDG_STATE_HOME=/nono-state

WORKDIR /app

RUN groupadd --gid 10001 app && \
    useradd --uid 10001 --gid app --create-home --home-dir /home/app \
      --shell /usr/sbin/nologin app

COPY --from=nono /usr/local/bin/nono /usr/local/bin/nono
COPY --from=build /build/package.json ./
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY web ./web
COPY typescript/container-policy.json /etc/nono/container-policy.json
COPY --chmod=0555 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8000/api/agent').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
