# AI CV Builder

Turns a PDF CV or free text plus a target role into a clean, English, role-targeted CV.
Every fact in the result is checked against what you provided: anything the AI cannot back up
with your own words is removed and turned into a clarifying question. You can answer or skip
questions, edit any field by hand (autosaved), and download an A4 PDF.

Specification: [`docs/SPEC.md`](docs/SPEC.md). Development plan: [`docs/plans/`](docs/plans/README.md).

## Quick start

Requires Docker with Compose v2.

```sh
cp .env.example .env
# set ANTHROPIC_API_KEY in .env
docker compose up
```

Open http://localhost:3000. The first start builds the images and applies database
migrations; `docker compose ps` shows all services `healthy` once ready.

Redis GUI: http://localhost:5540 (RedisInsight, already connected as `ai-cv-builder`; accept its
terms on first open). Published on localhost only; change the port with `REDISINSIGHT_PORT`.

`ANTHROPIC_API_KEY` is the only required value. `BETTER_AUTH_SECRET` has a local-only default
in `docker-compose.yml`; set your own in `.env` for anything beyond your machine.

## Monorepo layout

```
apps/
  web/        Next.js (App Router) — UI only; proxies /api/* to the API
  api/        NestJS on Express — REST API (src/main.ts) and worker (src/worker.ts)
packages/
  shared/     Zod schemas, types, error codes, field-path helpers used by web and api
docs/         SPEC and phase plans
```

## Development on the host

Node 24 (`.nvmrc`) and pnpm 11.

```sh
pnpm install            # also builds packages/shared and generates the Prisma client
cp .env.example .env    # DATABASE_URL / REDIS_URL point at localhost
pnpm infra:up           # db + redis on 127.0.0.1, RedisInsight on :5540
pnpm --filter @cv/api db:deploy
pnpm dev                # shared (watch), api :3001, worker, web :3000
```

| Script                             | What it does                                        |
| ---------------------------------- | --------------------------------------------------- |
| `pnpm dev`                         | All apps in watch mode                              |
| `pnpm build`                       | Build every package                                 |
| `pnpm typecheck`                   | `tsc` in every package                              |
| `pnpm lint` / `pnpm format`        | ESLint / Prettier                                   |
| `pnpm test`                        | Unit + integration tests                            |
| `pnpm test:unit`                   | Unit tests only (no Docker needed)                  |
| `pnpm test:int`                    | Integration tests (Testcontainers: needs Docker)    |
| `pnpm infra:up` / `infra:down`     | Postgres, Redis, RedisInsight for host development  |
| `pnpm --filter @cv/api db:migrate` | Create and apply a migration (`prisma migrate dev`) |
