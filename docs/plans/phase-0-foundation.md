# Phase 0 — Foundation

**Goal:** a fresh clone starts with `docker compose up`, all five services are healthy, the test harness and CI run, and the riskiest infrastructure assumptions (what the Next.js rewrite does to SSE, client IP, and `Origin`) are verified.
**Covers:** SPEC §6, §6.1 (Redis config), NFR-R8 (logging skeleton, health), NFR-R9, NFR-S8, NFR-S10.
**Depends on:** nothing

## Scope

### Monorepo
- [ ] pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`. Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`.
- [ ] Shared TS base config; ESLint + Prettier.
- [ ] Choose **one** module format for `packages/shared` up front: build with `tsc` (or `tsup`) to `dist` with types; Next consumes it via `transpilePackages`, Nest via the built output. Verify both apps import it before moving on.
- [ ] `.gitignore` (`.env`, `node_modules`, `dist`, `.next`), `.env.example` with `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `REDIS_URL`.

### packages/shared
- [ ] Error code enum and `ApiError` type `{ code, message, fields? }`.
- [ ] Field-path helpers (build and parse `experience.<id>.bullets.<id>`; see README conventions).
- [ ] Empty modules for `cv`, `auth`, `jobs`, `questions` schemas, filled in by later phases.
- [ ] Vitest config (one Vitest workspace for the repo, see [testing.md](testing.md)).

### apps/api (NestJS on Express)
- [ ] Two entrypoints: `main.ts` (HTTP) and `worker.ts` (`NestFactory.createApplicationContext`). The worker only logs "ready" for now.
- [ ] `NestFactory.create(AppModule, { bodyParser: false })`, then re-enable `json({ limit: '1mb' })` and `urlencoded` for every path **except** `/api/auth/*` (SPEC §7 risk #1).
- [ ] Global prefix `api`, excluding `/health` and `/ready`.
- [ ] `helmet` (CSP, `frame-ancestors 'none'`, `X-Content-Type-Options`).
- [ ] Global `ZodValidationPipe` that strips unknown keys and returns `400 { code: VALIDATION_ERROR, fields }`.
- [ ] Global exception filter: always `{ code, message }`, never stack traces or SQL. Unknown errors → `500 INTERNAL`.
- [ ] `nestjs-pino`: JSON logs, `requestId` (from header or generated), redaction of `authorization`, `cookie`, `body`, `email`.
- [ ] Prisma 7: `prisma.config.ts`, `prisma-client` generator with an explicit output path, `@prisma/adapter-pg`, `PrismaService` with graceful disconnect. Initial empty migration.
- [ ] `RedisModule` with three ioredis connection factories: `general`, `bullmq` (`maxRetriesPerRequest: null`), `subscriber`.
- [ ] `/health` (liveness, always 200) and `/ready` (Postgres `SELECT 1` **and** Redis `PING`, else 503).
- [ ] `ConfigModule` with a Zod-validated env schema. **Every interval, timeout, and limit is read from config** (LLM 120 s, extraction 15 s, render 10 s, job deadline 10 min, sweeper 30 s, rate limits), so tests can shorten them (SPEC NFR-R4).

### apps/web (Next.js App Router)
- [ ] TypeScript, Tailwind, `shadcn init --base aria`. Add only: button, field, input, textarea, dialog, tabs, toast.
- [ ] `next.config` rewrite `/api/:path*` → `${API_INTERNAL_URL}/api/:path*`.
- [ ] Mobile-first app shell (single column, `dvh`, safe-area padding, 16 px input font).
- [ ] Typed `apiFetch` wrapper: JSON, `credentials: 'include'`, parses `ApiError`, global 401 → `/login`.

### docker compose
- [ ] `db`: `postgres:16`, named volume, `pg_isready` healthcheck.
- [ ] `redis`: `redis:7` with `--appendonly yes --appendfsync everysec --maxmemory-policy noeviction`, named volume, `redis-cli ping` healthcheck, **no published port** (NFR-S1).
- [ ] `api`, `worker`, `web`: Dockerfiles (multi-stage, pnpm). `depends_on: condition: service_healthy`.
- [ ] Migrations: `prisma migrate deploy` runs before the API starts (entrypoint script or a one-shot `migrate` service that `api` and `worker` depend on with `service_completed_successfully`).
- [ ] `ANTHROPIC_API_KEY` is the only value that must be in `.env`. `BETTER_AUTH_SECRET` gets a dev default in compose, overridable from `.env`.

### Project docs (root)
- [ ] `README.md` skeleton: what the app does, quick start (`cp .env.example .env` → set `ANTHROPIC_API_KEY` → `docker compose up` → URL), monorepo layout, root scripts, and an empty **Decisions** section that later phases append to.
- [ ] `CLAUDE.md` with what the code cannot tell an agent:
  - **Commands:** `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, Prisma migrate/generate, how to start the stack.
  - **Layout rules:** `apps/web` is UI only (no business logic in Route Handlers or Server Actions); all logic lives in `apps/api`; contracts (Zod schemas, types, error codes) live in `packages/shared` and are written first.
  - **Invariants** (from SPEC and `docs/plans/README.md`): Postgres is the source of truth, Redis holds only ephemeral or rebuildable data; no secrets in the client bundle (no `NEXT_PUBLIC_` for secrets); errors are `{ code, message, fields? }`; no PII or CV text in logs.
  - **Conventions:** field paths, error codes, job states (link to `docs/plans/README.md` rather than duplicating).
  - **Where to look:** `docs/SPEC.md`, `docs/plans/`, and which project skill to use for which area.
  - Keep it short: rules and pointers, not a copy of the SPEC.

### Test infrastructure
- [ ] Set up what [testing.md](testing.md) describes: Vitest workspace, Testcontainers for Postgres and Redis (the compose Redis has no published port), a `test:unit` / `test:int` split, and a GitHub Actions workflow running typecheck, lint, and both suites.

### Spike: what the Next.js rewrite does to requests (do it now, not in Phase 2)
- [ ] Temporary `GET /api/_spike/sse` emitting a tick every second, and `GET /api/_spike/headers` echoing the request headers it received.
- [ ] **SSE:** open it through Next (`next start` in compose, not just `next dev`) and confirm ticks arrive one by one. Set `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`; disable compression for that route if needed.
- [ ] **Client IP:** confirm `X-Forwarded-For` reaches the API with the browser's address; better-auth's rate limit depends on it (AC-1.6). If the rewrite does not set it, add it explicitly.
- [ ] **Origin and cookies:** confirm `Origin` survives the rewrite (NFR-S3) and a `Set-Cookie` from the API lands on the web origin.
- [ ] Record the results in the README **Decisions** section. If the rewrite buffers SSE, Phase 2 relies on the `GET /api/jobs/:id` fallback (AC-5.4) or calls the API directly with CORS and credentials. Delete the spike endpoints afterwards.

## Tests
- `/ready` returns 503 when Redis is stopped and 200 when both are up.
- A JSON `POST` to a dummy non-auth route is parsed (guards against the `bodyParser: false` regression).
- Exception filter returns `{ code, message }` without a stack trace.

## Definition of done
- `git clone` → `cp .env.example .env` → `docker compose up` → all services healthy; `web` renders; `/ready` is 200.
- The spike results (SSE, client IP, Origin, cookies) are written down.
- CI is green on the first push.
- Root `README.md` and `CLAUDE.md` exist; the quick start in the README works as written.
- `pnpm -r typecheck && pnpm -r test` is green.
