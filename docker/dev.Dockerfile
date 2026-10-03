# Development image for `docker compose up` (docker-compose.override.yml). It contains only
# the toolchain: the repo is bind-mounted at /repo, and node_modules live in named volumes
# (they hold Linux binaries, so they cannot be shared with a macOS host).
FROM node:24-slim
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
# openssl: Prisma's schema engine (migrate) needs it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.16.0
WORKDIR /repo
