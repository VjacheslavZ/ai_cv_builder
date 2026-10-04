# One image for the HTTP API, the worker, and the one-shot migration. Build context: repo root.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
# openssl: Prisma's schema engine (used by `migrate deploy`) needs it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.16.0

# --- build: install, generate the Prisma client, compile shared + api ---
FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@cv/api..."
RUN pnpm --filter "@cv/api..." build

# --- migrate: runs `prisma migrate deploy` once, before api and worker start ---
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# --- deploy: a self-contained copy of @cv/api with production dependencies ---
FROM build AS deploy
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @cv/api deploy --prod --legacy /out

# --- runtime: production dependencies and compiled output only ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deploy --chown=node:node /out/package.json ./package.json
COPY --from=deploy --chown=node:node /out/node_modules ./node_modules
COPY --from=deploy --chown=node:node /out/dist ./dist
# PDF export fonts, resolved as `../../assets/fonts` from dist/pdf.
COPY --from=deploy --chown=node:node /out/assets ./assets
USER node
EXPOSE 3001
# `node dist/worker.js` for the worker (see docker-compose.yml).
CMD ["node", "dist/main.js"]
