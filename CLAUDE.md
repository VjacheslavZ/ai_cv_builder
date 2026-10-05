# CLAUDE.md

Rules and pointers for working in this repo. The SPEC is the source of truth; this file does not repeat it.

## Commands

- `pnpm install` — also builds `packages/shared` and runs `prisma generate` (root `postinstall`).
- `docker compose up` (= `pnpm dev`) — development in Docker with hot reload: `docker-compose.override.yml` bind-mounts the repo; web runs `next dev`, api/worker run `tsc --watch` + `node --watch`, `shared` rebuilds packages/shared. `node_modules`, `apps/api/dist`, and `apps/web/.next` are Docker volumes. New dependency: `docker compose run --rm deps`, then restart the apps. Migrations: `docker compose exec api pnpm --filter @cv/api db:migrate`.
- Production images: `docker compose -f docker-compose.yml up --build` (`pnpm prod`); `docker-compose.override.yml` must not leak into it, so production-only settings stay in `docker-compose.yml`.
- `pnpm dev:host` runs the apps on the host instead (needs `pnpm infra:up` and the compose app containers stopped).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- `pnpm eval:llm`: manual LLM quality run against the **real API** (reads `ANTHROPIC_API_KEY` from `.env`, costs money, never in CI). Runs the production generation loop; grades with deterministic checks, an LLM judge (`EVAL_JUDGE_MODEL`, default `claude-haiku-4-5`), and a blind comparison with the frozen baseline (`EVAL_SAVE_BASELINE=true` to save one); results in `apps/api/eval/out/` (git-ignored). Save a baseline before every prompt change, run it after (docs/plans/testing.md).
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
- **PDF export** (`GET /api/cvs/:id/pdf`) renders only the **saved** document, read from Postgres on every request (no cache, `no-store`); the web flushes autosave first (`apps/web/lib/download-pdf.ts`) and then navigates to the URL (no blob, no client PDF code). Template: `apps/api/src/pdf/cv-pdf-template.ts` (`React.createElement`, no JSX), print rules in `cv-pdf-format.ts`; fonts (Noto Sans regular + bold, OFL) in `apps/api/assets/fonts`, copied into the runtime image. react-pdf lays out synchronously (seconds for a long CV), so rendering runs in a `worker_thread` (`CvPdfRenderer`, `terminate()` after `PDF_RENDER_TIMEOUT_MS`). Under Vitest the worker runs the `.ts` source and `cv-pdf-render.worker.ts` maps relative `.js` imports to `.ts`; keep the render modules free of TypeScript-only syntax (enums, parameter properties).
- Never block the worker's event loop: BullMQ renews locks only while it is free (CPU work such as PDF parsing runs in a `worker_thread`). Keep `lockDuration` near the default.
- Permanent job failures throw `PermanentJobError(code)` (marked failed, then `UnrecoverableError`); anything else is retried by BullMQ and fails the DB job on the last attempt.
- Manual edits are tracked in `CvDocument.editedPaths` (field paths), not per-field flags. Editable paths, their value schemas, and reads/writes go through `packages/shared/src/cv/fields.ts` (`fieldValueSchema`, `getField`, `setField`); PATCH, simple-field answers, and the AI merge all use them.
- **The AI never changes a manually edited field**, enforced on the server, not by the prompt: `apply_answer` merges the rewritten part by item id and then restores every `editedPaths` field from the current document byte for byte (`worker/apply/merge-section.ts`). Items the model kept but grounding removed keep their current version; a rewrite fills fields, it never clears them.
- **Every CV write** (PATCH, answer, AI commit) takes the CV row lock and bumps `version` (except the title, `PATCH /api/cvs/:id/title`: it is not part of the document, so it changes neither `version` nor the lock); **only AI writes bump `aiRevision`**, which fences `apply_answer` commits (a changed `aiRevision` discards the result and BullMQ retries). A manual PATCH never makes an AI job retry.
- `apply_answer` jobs take the per-CV Redis lock (`worker/apply/cv-lock.ts`, `SET NX PX` + compare-and-delete); a job that finds it taken goes back to delayed (`moveToDelayed` + `DelayedError`) without using an attempt. The lock only serializes; fencing is the safety net.
- Questions: a manual edit of a questioned place resolves it in the same transaction; at most 10 `open` at a time. A failed `apply_answer` fails the question, never the CV, and publishes `question_failed` (not `failed`, which means the generation failed).
- Web autosave logic lives in the plain module `apps/web/lib/autosave.ts` (unit-tested, no React): latest value per path, debounce + flush on blur / tab hidden, one request in flight, AI updates of other parts re-sent automatically, an unexplained 409 becomes the conflict UI. Never send a value that fails `fieldValueSchema` (one bad op rejects the whole PATCH).
- **English only** (SPEC decision 3): input, CV, and UI. Do not add i18n, translation, transliteration, or non-English rules (month names, units, injection patterns) to grounding or prompts.
- **LLM output is untrusted.** Every response goes through the Zod schema (`llmCvOutputSchema`) **and** the deterministic grounding check (`apps/api/src/grounding/`) before it can touch a CV; unsupported facts are removed and become `unverified` questions. Never bypass either, never save a partially valid answer.
- Source text reaches the LLM only as delimited data (`<source kind="…">`, `llm/prompt.ts`); sentences that address the model are stripped before grounding (`grounding/source.ts`). Never log prompts, responses, or source text: log ids, token counts, durations, removal counts.
- Every LLM call checks the job deadline first (a call that no longer fits fails the job with `JOB_TIMEOUT`); errors go through `classifyLlmError` (retryable vs permanent).
- Structured output uses `output_config.format` (from the Zod schema), not forced `tool_choice`: current models reject forced tool use.
- Tests never need `ANTHROPIC_API_KEY`: they use `FakeLlmClient` (`LLM_PROVIDER=fake`, scripted with `valid` / `invalid` / `raw` / `fabricated` / `transient` / `permanent` / `slow`).
- The Next rewrite does not forward the client IP; `apps/web/server/forwarded-for.cjs` (preloaded in the web image) sets `X-Forwarded-For` from the socket and overwrites client-supplied values. Behind a trusted load balancer it must append instead.

## Conventions

Field paths, error codes, job states, question statuses, IDs, and dates: [`docs/plans/README.md`](docs/plans/README.md#cross-cutting-conventions). Field-path helpers: `packages/shared/src/field-path`.

React components (`apps/web/app`, `apps/web/components`) stay around 150 lines (ESLint `max-lines` warns above 150, not counting blank lines and comments; shadcn's `components/ui` is exempt). Split a larger one into subcomponents in their own files, hooks, and pure logic in `lib/` with a unit test, e.g. `new-cv-form` → `pdf-picker`, `source-text-field`, `lib/create-cv-errors.ts`. Keep a `useWatch` subscription in the smallest component that needs it.

## Where to look

- [`docs/SPEC.md`](docs/SPEC.md): requirements and acceptance criteria.
- [`docs/plans/`](docs/plans/README.md): phase plans; [`testing.md`](docs/plans/testing.md): test strategy and harness.
- Project skills (`.claude/skills/`): Prisma → `prisma-upgrade-v7`, `prisma-client-api`, `prisma-cli`; Postgres → `supabase-postgres-best-practices`; auth → `better-auth-*`, `email-and-password-best-practices`; Nest → `nestjs-best-practices`; React/Next → `vercel-react-best-practices`; UI → `shadcn`; tests → `vitest`, `webapp-testing`; other library docs → `context7-mcp`.
