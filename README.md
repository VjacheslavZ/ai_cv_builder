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

Open http://localhost:3000. The first start builds the images, installs dependencies, and
applies database migrations; `docker compose ps` shows all services `healthy` once ready.

`docker compose up` runs the app in **development mode** with hot reload (it merges
`docker-compose.override.yml`). For the production images, without the override:

```sh
docker compose -f docker-compose.yml up --build   # or: pnpm prod
```

Redis GUI: http://localhost:5540 (RedisInsight, already connected as `ai-cv-builder`; accept its
terms on first open). Published on localhost only; change the port with `REDISINSIGHT_PORT`.

`ANTHROPIC_API_KEY` is the only required value. `BETTER_AUTH_SECRET` has a local-only default
in `docker-compose.yml` (and outside `NODE_ENV=production` on the host); set your own in `.env`
for anything beyond your machine.

## Accounts and sessions

Email and password via [better-auth](https://better-auth.com), served by the API at `/api/auth/*`
through the web origin. Users and password hashes (scrypt) are in Postgres; sessions and auth
rate-limit counters are only in Redis, so logout revokes a session immediately and a Redis wipe
only logs everyone out. The session cookie is `httpOnly`, `SameSite=Lax`, and `Secure` unless
`WEB_ORIGIN` is localhost. Every API route requires a session unless explicitly public, and a
user only ever sees their own data (another user's id answers `404`). If Redis is down,
authenticated calls answer `503` instead of guessing.

`WEB_ORIGIN` (default `http://localhost:3000`) must be the URL users open: it is the only
origin allowed to send mutating requests.

## Creating a CV: jobs and limits

**Input** (`/cvs/new`): a target role (1–100 characters) plus a PDF (≤ 10 MB, ≤ 10 pages, with a
text layer), pasted text (≤ 20,000 characters), or both. A scanned PDF without text fails with a
clear message, or, when text was pasted too, is skipped with a warning that stays on the CV.
Generation is limited to 2 running jobs per user and 20 per hour.

**Jobs.** Creating a CV writes the CV, its source text, the temporary PDF, and a `queued` job
to Postgres in one transaction, then enqueues the job in BullMQ (queue `cv-jobs`) and answers
`202` at once. The worker runs the stages `queued → extracting → generating → validating →
completed` (or `failed`), and the progress page follows them live over SSE; reloading or
opening the CV on another device shows the same job. Postgres holds the state you see; a
sweeper in the worker re-enqueues jobs lost between Postgres and Redis, retries jobs whose
worker crashed (BullMQ stalled detection), and fails anything still running 10 minutes after
it was created (`JOB_TIMEOUT`). On `SIGTERM` (`docker compose stop`) the worker finishes its
current job, up to 30 s.

Until Phase 3 the worker uses an offline **fake LLM** (`LLM_PROVIDER=fake`): the "draft" is your
source lines, so the whole flow works without spending API credits.

**PDF retention.** The original PDF is not kept: its bytes sit in a temporary Postgres table
until the worker extracts the text (then they are deleted in the same transaction), and are
also deleted after a failed extraction or by the sweeper 24 h after upload at the latest.

**Manual edits** are tracked as one `editedPaths` set of field paths on the CV document (for
example `summary` or `experience.<id>.bullets.<id>`), not as a `userEdited` flag on every
field: plain string fields stay plain, and the set moves with the document in every write.

## Monorepo layout

```
apps/
  web/        Next.js (App Router) — UI only; proxies /api/* to the API
  api/        NestJS on Express — REST API (src/main.ts) and worker (src/worker.ts)
packages/
  shared/     Zod schemas, types, error codes, field-path helpers used by web and api
docs/         SPEC and phase plans
```

## Development

Everything runs in Docker: `docker compose up` (or `pnpm dev`). The repo is bind-mounted into
the containers, so edits apply without rebuilding images:

- `web` runs `next dev`: components hot-reload in the browser.
- `api` and `worker` run `tsc --watch` + `node --watch`: they restart a few seconds after a save.
- `shared` rebuilds `packages/shared`; api and web pick up the change.

`node_modules` live in Docker volumes (Linux binaries), installed by the one-shot `deps`
service on every `up`. After adding a dependency (`pnpm add …` on the host updates the
lockfile), run `docker compose run --rm deps` and `docker compose restart api worker web`.

Database GUI (DataGrip, psql): Postgres is published on `127.0.0.1:${DEV_POSTGRES_PORT:-5432}`
in development mode, database `cv`, user `cv`, password `cv`. Redis is not published; use
RedisInsight.

Database changes: edit `apps/api/prisma/schema.prisma`, then
`docker compose exec api pnpm --filter @cv/api db:migrate` (creates and applies a migration
and regenerates the client) and `docker compose restart api worker`.

Running the apps on the host instead (Node 24, pnpm 11): `pnpm install`, `pnpm infra:up`
(Postgres and Redis on 127.0.0.1; set `DEV_POSTGRES_PORT` / `DEV_REDIS_PORT` and the matching
`DATABASE_URL` / `REDIS_URL` in `.env` if the ports are taken), `pnpm --filter @cv/api db:deploy`,
then `pnpm dev:host`. Stop the compose `web`, `api`, and `worker` first: they hold :3000.

| Script                             | What it does                                        |
| ---------------------------------- | --------------------------------------------------- |
| `pnpm dev`                         | `docker compose up --build`: dev mode, hot reload   |
| `pnpm prod`                        | Production images (`-f docker-compose.yml` only)    |
| `pnpm dev:host`                    | Apps on the host in watch mode (needs `infra:up`)   |
| `pnpm build`                       | Build every package                                 |
| `pnpm typecheck`                   | `tsc` in every package                              |
| `pnpm lint` / `pnpm format`        | ESLint / Prettier                                   |
| `pnpm test`                        | Unit + integration tests                            |
| `pnpm test:unit`                   | Unit tests only (no Docker needed)                  |
| `pnpm test:int`                    | Integration tests (Testcontainers: needs Docker)    |
| `pnpm infra:up` / `infra:down`     | Postgres, Redis, RedisInsight for host development  |
| `pnpm --filter @cv/api db:migrate` | Create and apply a migration (`prisma migrate dev`) |
