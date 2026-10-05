# Phase 6 — Hardening & release

**Goal:** prove the guarantees across the whole system, close gaps the per-phase tests could not cover, and leave a README a reviewer can follow from a fresh clone.
**Covers:** SPEC §5.4 items 1–6 (P0 part), NFR-R8, NFR-R10–R12, NFR-S2, NFR-M1, NFR-M7, NFR-M8, §7 risks.
**Depends on:** Phases 4 and 5

## Scope

### Cross-cutting test suites
- [x] **User isolation matrix** (NFR-S2, AC-2.1): user B against every endpoint for user A's CV: `GET`/`PATCH`/`DELETE` CV, retry, events (SSE), job status, answer, dismiss, PDF → all `404`, and A's data unchanged. Drive it from a table so new endpoints (regenerate, undo, rename in Phase 7) are one line each. `apps/api/test/isolation.int.test.ts` (`ENDPOINTS`).
- [x] **Full-flow e2e API** with `FakeLlmClient`: sign up → create from PDF → `ready` → answer (LLM path and simple path) → dismiss → manual patch → PDF → delete → `404`. `apps/api/test/full-flow.int.test.ts`.
- [x] **Redis resilience:** restart the redis container → the user is still logged in and a queued job completes (NFR-R11); stop Redis → authenticated calls `503`, nothing lost; start it → the sweeper re-enqueues `queued` and lost `running` jobs (NFR-R12, AC-5.7a). `apps/api/test/redis-resilience.int.test.ts`; the Redis is the file's own, behind a stable-port proxy (`test/support/own-redis.ts`).
- [x] **No PII in logs** (NFR-R8, NFR-S11): run the full flow with a capturing logger and assert that no email, CV text, answer text, or API key appears. Same file as the full flow (`logDestination` in the test harness, `loggerParams` in `logging/logger.module.ts`).
- [x] **`bodyParser` regression** (SPEC §7): one auth route and one CV JSON route in the same e2e test (the full flow: sign-up, PATCH, sign-out).
- [ ] **Playwright mobile smoke (P0, SPEC §5.4 item 6):** the full flow at 360×740 with `FakeLlmClient`; assert no horizontal scrolling on every screen (NFR-M1). See [testing.md](testing.md).
- [ ] Fill the **AC → test** table in [testing.md](testing.md): every P0 AC points to at least one test.

### Configuration review
- [ ] Re-check against SPEC: `lockDuration` near default and no event-loop blocking, `maxStalledCount`, `attempts`, the per-job LLM deadline, all timeouts (LLM 120 s, extraction 15 s, render 10 s, job 10 min), PDF retention, rate limits (auth, generation, answers), client IP via `X-Forwarded-For`, input limits, cookie flags, helmet CSP, Redis flags, `NEXT_PUBLIC_` audit (no secrets in the client bundle, NFR-S8).
- [x] Graceful shutdown: `docker compose stop worker` mid-job → the job finishes within 30 s or is recovered as stalled (NFR-R10). `worker-crash.int.test.ts` sends a real `SIGTERM` to the compiled worker. **Fixed:** after `WORKER_SHUTDOWN_TIMEOUT_MS` the worker used to call `close(true)`, which BullMQ turns into the still-pending graceful close, so the process waited for the job (up to the LLM timeout) and was `SIGKILL`ed by compose; it now stops waiting and exits.

### Mobile & accessibility pass
- [ ] Manual run at 375×667 (`webapp-testing` skill or devtools): keyboard does not cover inputs, the questions tab is reachable (NFR-M2, M6).
- [ ] Keyboard-only pass on desktop; check `aria-live` announcements for saving, updating, and stages; contrast (NFR-M8).
- [ ] Bundle check: initial JS ≤ 250 KB gzip on dashboard and editor (`next build` output) (NFR-M7).

### README (finalize the file started in Phase 0)
- [ ] Quick start: `cp .env.example .env`, set `ANTHROPIC_API_KEY`, `docker compose up`, open the URL.
- [ ] Architecture diagram (web → api → Postgres/Redis ← worker), the Postgres/Redis split (SPEC §6.1), job lifecycle.
- [ ] How grounding works and its known limits.
- [ ] Running the tests; the real-key evaluation run.

### CLAUDE.md
- [ ] Check every command still works and every invariant still matches the code; remove anything stale.
- [ ] Add the test layout: where unit, integration, and e2e tests live and which one to run for which change.

## Definition of done
- Fresh clone on a clean machine → `docker compose up` → the full flow works (NFR-R9).
- All §5.4 P0 items are green in CI without a real API key.
- Every P0 AC has a test in the AC → test table.
- README is complete; CLAUDE.md matches the code.
