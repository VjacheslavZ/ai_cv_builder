# CLAUDE.md

Rules and pointers for working in this repo. The SPEC is the source of truth; this file does not repeat it.

## Commands

- `pnpm install` — also builds `packages/shared` and runs `prisma generate` (root `postinstall`).
- `docker compose up` (= `pnpm dev`) — development in Docker with hot reload: `docker-compose.override.yml` bind-mounts the repo; web runs `next dev`, api/worker run `tsc --watch` + `node --watch`, `shared` rebuilds packages/shared. `node_modules`, `apps/api/dist`, and `apps/web/.next` are Docker volumes. New dependency: `docker compose run --rm deps`, then restart the apps. Migrations: `docker compose exec api pnpm --filter @cv/api db:migrate`.
- Production images: `docker compose -f docker-compose.yml up --build` (`pnpm prod`); `docker-compose.override.yml` must not leak into it, so production-only settings stay in `docker-compose.yml`.
- `pnpm dev:host` runs the apps on the host instead (needs `pnpm infra:up` and the compose app containers stopped).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- `pnpm test:unit` (no Docker), `pnpm test:int` (Testcontainers, needs Docker), `pnpm test` (both). One file: `pnpm vitest run --project api-int apps/api/test/<name>.int.test.ts`. Integration tests run the HTTP app (`createTestApp`) and the worker (`startTestWorker`, scripted `FakeLlmClient`) in-process with their own database and `BULLMQ_PREFIX` (`uniqueQueuePrefix()`); call `Sweeper.tick()` directly instead of waiting for the interval. The crash test compiles the api into `apps/api/.test-build` and runs the worker as a child process.
- better-auth models: regenerate with `pnpm dlx auth@<better-auth version> generate --config <file> --output prisma/schema.prisma` against a minimal config with the same `database`/`secondaryStorage`/plugins, then re-apply the plural `@@map` and `Timestamptz` edits and add a migration.
- Prisma (from `apps/api`): `pnpm db:migrate` (create + apply, dev), `pnpm db:deploy`, `pnpm db:generate`. Config: `apps/api/prisma.config.ts`.
- Full stack: `docker compose up` (needs `ANTHROPIC_API_KEY` in `.env`). `/ready` is not proxied by web; check `docker compose ps`.
- Redis GUI: RedisInsight at http://localhost:5540, already connected to `redis`. Starts with `docker compose up` and `pnpm infra:up` (service `redisinsight`, localhost only); it is a dev aid, the app never depends on it.

## Layout rules

- `apps/web` is UI only: no business logic in Route Handlers or Server Actions. It calls the API through the same-origin `/api/*` rewrite with `apiFetch` (`apps/web/lib/api-fetch.ts`).
- All logic lives in `apps/api`. The HTTP entrypoint is `src/main.ts`, the worker is `src/worker.ts`; both share modules. HTTP middleware setup is in `src/bootstrap/configure-app.ts` and is reused by integration tests.
- Contracts (Zod schemas, types, error codes, field paths) live in `packages/shared` and are written **before** the endpoint or form that uses them. Validate request DTOs with `@Body({ schema })`.
- Every interval, timeout, and limit comes from `apps/api/src/config/env.schema.ts`; never hard-code one.
- Nest DI reads constructor parameter types at runtime: in `apps/api` use value imports for injected classes, not `import type`.
- `apps/api` is ESM: relative imports end in `.js`.
- Never name a directory `cvs` (any case) in `apps/api`: `pnpm deploy` (npm-packlist) drops `CVS` directories, so it silently vanishes from the docker image. CV code lives in `src/cv/`.

## Invariants

- Postgres is the source of truth. Redis holds only ephemeral or rebuildable data (SPEC §6.1).
- Errors leave the API only as `{ code, message, fields? }` with a code from `packages/shared` (`ErrorCode`). Throw `ApiException`; anything else becomes `500 INTERNAL`.
- No secrets in the client bundle: never a `NEXT_PUBLIC_` secret; web code reads no server env (lint rule).
- No PII or CV text in logs: no CV content, answers, emails, cookies, or keys. Log ids, stages, durations, counts.
- `/api/auth/*` bodies are never parsed by our middleware (better-auth reads the raw stream). Its responses go through `rewriteAuthResponses` (`apps/api/src/auth/auth-responses.ts`): errors get our shape, and the session token never appears in a body.
- **Routes are protected by default** (global `AuthGuard` from `@thallesp/nestjs-better-auth`). `@AllowAnonymous()` is the explicit, rare exception (`/health`, `/ready`). Handlers get the user only via `@CurrentUser()` → `{ id }`.
- **Ownership:** repositories always take `userId` (`findOwned(id, userId)`, `listOwned(userId)`, `deleteOwned(id, userId)`). Not found **or** not owned → `404 NOT_FOUND` (`ownedOrNotFound`), never `403`. The owner comes only from the session; never read `userId`/`ownerId` from a body, param, or query (the Zod pipe strips them).
- **Redis failure → `503`:** a failed session lookup fails closed as `503 SERVICE_UNAVAILABLE`, never as anonymous or authenticated (mapped in `AllExceptionsFilter`). Keep better-auth's `cookieCache` off so every request checks Redis.
- Mutating non-auth requests need `Origin` = `WEB_ORIGIN` and a JSON or multipart body (`common/http/origin-check.ts`); tests send `Origin: TEST_ORIGIN`.
- SSE through the Next rewrite dies after 30 s of silence: send a heartbeat well under that.
- **Jobs** (`cv-jobs`): the BullMQ payload is ids only (`{ jobId }`) and the BullMQ `jobId` is the DB job id. Enqueue only **after** the DB commit (`CvQueueService.addAfterCommit`, never throws; the sweeper repairs lost enqueues). Jobs are at-least-once: every stage goes through `JobState`, which checks that the DB job is still active (a deleted CV cascades its jobs away) before writing, and results are written whole under `SELECT … FOR UPDATE` on the CV (lock the CV row first, then touch the job). Publish events only after commit.
- Never block the worker's event loop: BullMQ renews locks only while it is free (CPU work such as PDF parsing runs in a `worker_thread`). Keep `lockDuration` near the default.
- Permanent job failures throw `PermanentJobError(code)` (marked failed, then `UnrecoverableError`); anything else is retried by BullMQ and fails the DB job on the last attempt.
- Manual edits are tracked in `CvDocument.editedPaths` (field paths), not per-field flags.
- The Next rewrite does not forward the client IP; `apps/web/server/forwarded-for.cjs` (preloaded in the web image) sets `X-Forwarded-For` from the socket and overwrites client-supplied values. Behind a trusted load balancer it must append instead.

## Conventions

Field paths, error codes, job states, question statuses, IDs, and dates: [`docs/plans/README.md`](docs/plans/README.md#cross-cutting-conventions). Field-path helpers: `packages/shared/src/field-path`.

React components (`apps/web/app`, `apps/web/components`) stay around 150 lines (ESLint `max-lines` warns above 150, not counting blank lines and comments; shadcn's `components/ui` is exempt). Split a larger one into subcomponents in their own files, hooks, and pure logic in `lib/` with a unit test, e.g. `new-cv-form` → `pdf-picker`, `source-text-field`, `lib/create-cv-errors.ts`. Keep a `useWatch` subscription in the smallest component that needs it.

## Where to look

- [`docs/SPEC.md`](docs/SPEC.md): requirements and acceptance criteria.
- [`docs/plans/`](docs/plans/README.md): phase plans; [`testing.md`](docs/plans/testing.md): test strategy and harness.
- Project skills (`.claude/skills/`): Prisma → `prisma-upgrade-v7`, `prisma-client-api`, `prisma-cli`; Postgres → `supabase-postgres-best-practices`; auth → `better-auth-*`, `email-and-password-best-practices`; Nest → `nestjs-best-practices`; React/Next → `vercel-react-best-practices`; UI → `shadcn`; tests → `vitest`, `webapp-testing`; other library docs → `context7-mcp`.
