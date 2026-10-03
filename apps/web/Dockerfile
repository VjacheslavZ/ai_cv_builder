# Next.js standalone build. Build context: repo root.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.16.0

FROM base AS build
WORKDIR /repo
# Rewrites are resolved at build time, so the API address is baked into the image.
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=$API_INTERNAL_URL
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@cv/web..." --ignore-scripts
RUN pnpm --filter @cv/shared build && pnpm --filter @cv/web build

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/apps/web/server/forwarded-for.cjs ./forwarded-for.cjs
USER node
EXPOSE 3000
CMD ["node", "--require", "./forwarded-for.cjs", "apps/web/server.js"]
