# CLAUDE.md

Rules and pointers for working in this repo. The SPEC is the source of truth; this file does not repeat it.

## Commands

- `pnpm install` — also builds `packages/shared` and runs `prisma generate` (root `postinstall`).
- `pnpm dev` — shared (watch), api :3001, worker, web :3000. Needs `pnpm infra:up` (Postgres + Redis on localhost) and a `.env`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- `pnpm test:unit` (no Docker), `pnpm test:int` (Testcontainers, needs Docker), `pnpm test` (both).
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

## Invariants

- Postgres is the source of truth. Redis holds only ephemeral or rebuildable data (SPEC §6.1).
- Errors leave the API only as `{ code, message, fields? }` with a code from `packages/shared` (`ErrorCode`). Throw `ApiException`; anything else becomes `500 INTERNAL`.
- No secrets in the client bundle: never a `NEXT_PUBLIC_` secret; web code reads no server env (lint rule).
- No PII or CV text in logs: no CV content, answers, emails, cookies, or keys. Log ids, stages, durations, counts.
- `/api/auth/*` bodies are never parsed by our middleware (better-auth reads the raw stream).
- SSE through the Next rewrite dies after 30 s of silence: send a heartbeat well under that.
- The Next rewrite does not forward the client IP; `apps/web/server/forwarded-for.cjs` (preloaded in the web image) sets `X-Forwarded-For` from the socket and overwrites client-supplied values. Behind a trusted load balancer it must append instead.

## Conventions

Field paths, error codes, job states, question statuses, IDs, and dates: [`docs/plans/README.md`](docs/plans/README.md#cross-cutting-conventions). Field-path helpers: `packages/shared/src/field-path`.

## Where to look

- [`docs/SPEC.md`](docs/SPEC.md): requirements and acceptance criteria.
- [`docs/plans/`](docs/plans/README.md): phase plans; [`testing.md`](docs/plans/testing.md): test strategy and harness.
- Project skills (`.claude/skills/`): Prisma → `prisma-upgrade-v7`, `prisma-client-api`, `prisma-cli`; Postgres → `supabase-postgres-best-practices`; auth → `better-auth-*`, `email-and-password-best-practices`; Nest → `nestjs-best-practices`; React/Next → `vercel-react-best-practices`; UI → `shadcn`; tests → `vitest`, `webapp-testing`; other library docs → `context7-mcp`.
