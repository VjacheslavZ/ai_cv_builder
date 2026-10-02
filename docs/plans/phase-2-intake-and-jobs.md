# Phase 2 — CV intake & job pipeline

**Goal:** the full asynchronous path works end to end on a **fake LLM**: submit role + PDF/text → job row → BullMQ → worker extracts the PDF → fake generation → CV `ready`, with live stages over SSE and full recovery from crashes and lost enqueues.
**Covers:** FR-3, FR-4, FR-5, FR-12.1–12.3, NFR-R1–R7, NFR-R10, NFR-S4, NFR-S5, NFR-S9 (generation limits), NFR-M4.
**Depends on:** Phase 1

## Data model (Prisma)

| Model | Key fields | Notes |
|---|---|---|
| `Cv` | `id`, `userId`, `title`, `targetRole`, `status` (`generating`/`ready`/`failed`), `failureCode`, `warnings Json` (AC-4.3), `document Json?`, `version Int`, `aiRevision Int`, `idempotencyKey`, timestamps | `@@unique([userId, idempotencyKey])` (AC-3.4). `version` changes on every write, `aiRevision` only on AI writes (fencing, AC-9.7). |
| `SourceText` | `id`, `cvId`, `kind` (`pdf`/`free_text`/`answer`/`manual`), `text`, `createdAt` | The facts. Current manual edits are read from `userEdited` fields at check time; `manual` rows are written only when Regenerate resets them (FR-13, Phase 7). |
| `PdfUpload` | `cvId` (PK), `bytes Bytes`, `createdAt` | Temporary. Deleted after successful extraction (same transaction as the text), after a permanent extraction failure, or by the sweeper after 24 h. |
| `Job` | `id`, `cvId`, `userId`, `type` (`generate`/`apply_answer`), `status` (`queued`/`running`/`completed`/`failed`/`cancelled`), `stage`, `attempts`, `errorCode`, `errorMessage`, `questionId?`, `deadlineAt`, timestamps | `cancelled` is used when Regenerate cancels `apply_answer` jobs; deleting a CV cascades instead. |
| `Question` | `id`, `cvId`, `path`, `type` (`missing`/`vague`/`unverified`), `priority`, `text`, `status` (`open`/`applying`/`answered`/`dismissed`/`resolved`/`failed`), `answer?` | Filled in by Phase 3; statuses per AC-8.6. |
| `GroundingReport`, `AiSnapshot` | — | Created now so the schema is stable; filled in by Phases 3–4. |

- Every child table has `onDelete: Cascade` from `Cv` (AC-12.3, NFR-S11).
- **One active generation per CV** (AC-5.8): a partial unique index on `Job(cvId) WHERE type='generate' AND status IN ('queued','running')`. Prisma can't declare it, so add it with raw SQL in the migration.
- Indexes: `Cv(userId, updatedAt DESC)`, `Job(status, createdAt)` for the sweeper, `PdfUpload(createdAt)` for retention.

## Scope

### packages/shared
- [ ] `createCvSchema`: role 1–100 chars, text ≤ 20,000, at least one of text/file (AC-3.2, AC-3.3).
- [ ] Job/stage enums, `JobStatusDto`, SSE event union (`snapshot`, `stage`, `completed`, `failed`, `section_updated`, `heartbeat`).
- [ ] `CvDocument` schema (contact, summary, experience[], education[], skills[]) with UUIDs on entries, bullets, links, and skills; dates as `{ start, end }` with `YYYY` / `YYYY-MM` / `present` (SPEC glossary). Manual edits are tracked as an `editedPaths: string[]` set or a per-field `userEdited` flag: **pick one now**, Phase 4 depends on it.
- [ ] Field-path schema covering both field paths and list/section paths (`experience.<id>.bullets`, `education`).

### apps/api — HTTP
- [ ] `POST /api/cvs` (multipart): multer `memoryStorage`, `limits: { fileSize: 10 MB, files: 1 }` → `413`; MIME + `%PDF-` signature → `415` (AC-4.2); Zod for the fields → `400`.
- [ ] Generation limits (NFR-S9), applied to create now and to retry/regenerate later: ≤ 2 active **generation** jobs per user counted in Postgres; ≤ 20 generations/hour via `INCR rl:gen:{userId}:{hour}` + `EXPIRE 3600` → `429`.
- [ ] One interactive transaction: insert `Cv`, `SourceText(free_text)`, `PdfUpload`, `Job(queued)`. A unique violation on `idempotencyKey` → return the **existing** `{ cvId, jobId }` with the same status code (AC-3.4).
- [ ] **After commit**, `queue.add('generate', { jobId }, { jobId })` (payload = ids only; BullMQ `jobId` = DB id). An enqueue failure is logged and left to the sweeper; the response is still `202` in under 1 s (AC-3.1).
- [ ] `GET /api/cvs` (list: title, status, open-question count, `updatedAt`, newest first, AC-12.1), `GET /api/cvs/:id` (document, questions, active jobs, warnings, version), `DELETE /api/cvs/:id` (AC-12.3).
- [ ] `GET /api/jobs/:id` (fallback status, ownership-checked).
- [ ] `GET /api/cvs/:id/events` (SSE): ownership check → send a `snapshot` from Postgres → stream live events from one shared Redis subscriber (`cv:{cvId}:events`, fanned out in-process) → `heartbeat` every 15 s. Clean up on disconnect (AC-5.1).

### apps/api — worker
- [ ] BullMQ `Worker` on queue `cv-jobs`, concurrency 2–4. **Keep `lockDuration` near the default (30 s):** BullMQ renews locks automatically while the event loop is free, so the 120 s LLM call needs no long lock, and a crashed worker is detected quickly (AC-5.7). `maxStalledCount` 1–2. Log every `stalled` event.
- [ ] Job defaults: `attempts: 3`, exponential backoff with jitter. Permanent errors → `UnrecoverableError` (NFR-R3).
- [ ] **At-least-once:** a job may run twice. Before each stage and before the final write, check the DB job is still active **and** the CV still exists; otherwise stop quietly (AC-5.9). On delete, the API also removes the waiting BullMQ job.
- [ ] Stage transitions: update `Job.stage` in Postgres → commit → publish to `cv:{cvId}:events`.
- [ ] **PDF extraction** in a `worker_thread` with `resourceLimits` and a 15 s timeout (`terminate()` on expiry), using `pdfjs-dist` / `unpdf`. The event loop is never blocked. Rejects > 10 pages, encrypted, and corrupted files with a clear code and deletes the `PdfUpload`. < ~200 meaningful characters → `PDF_NO_TEXT`, or continue with free text and add a warning to `Cv.warnings` (AC-4.1–4.4). Save text + delete `PdfUpload` in one transaction.
- [ ] `LlmClient` interface + `FakeLlmClient` with scripted scenarios (valid CV, invalid output, fabricated facts, transient error, permanent error, slow), see [testing.md](testing.md). The generate pipeline runs `extracting → generating → validating → completed` with the fake.
- [ ] Result write: one transaction under `SELECT … FOR UPDATE` on the CV: write the document, `version + 1`, `aiRevision + 1`, `status = ready`, job `completed`. Results are written whole, never appended (NFR-R6, R7).
- [ ] **Sweeper** (interval from config, default 30 s; in the worker, guarded by a Redis lock so only one instance runs it):
  - re-enqueue jobs `queued` for > 30 s, and jobs `running` in Postgres that no longer exist in BullMQ, with `jobId` = DB id (AC-5.7a);
  - fail jobs past `deadlineAt` (10 min after creation) with `JOB_TIMEOUT` (NFR-R4);
  - delete `PdfUpload` rows older than 24 h.
- [ ] Graceful shutdown: on `SIGTERM` → `worker.close()`, wait ≤ 30 s (NFR-R10).

### apps/web
- [ ] Dashboard: list with status badge, open-question count, date; "New CV" button; delete with a confirm dialog.
- [ ] New CV form: role input + Tabs ("Upload PDF" with React Aria `FileTrigger` + `DropZone` on desktop, `acceptedFileTypes={["application/pdf"]}` / "Paste text") (NFR-M4). Sends an `Idempotency-Key` (UUID generated once per form instance). Maps `400 fields` via `setError`.
- [ ] Progress screen `/cvs/:id`: `EventSource` + stage list with `aria-live`; on `visibilitychange` (visible) or `error` → reconnect or `GET /api/jobs/:id` (AC-5.4, NFR-M5). Shows "Still working…" on retries and the failure reason + "Retry" (button wired in Phase 5). Shows `warnings` from the CV.

## Tests
- **Integration (real Postgres + Redis):**
  - create returns before the worker runs (NFR-R1);
  - same `Idempotency-Key` twice → one CV, one job, identical responses;
  - a second active generation → `409` with the existing job id;
  - enqueue failure → the sweeper picks the job up without duplicates;
  - a `running` job removed from Redis → the sweeper re-enqueues it;
  - kill the worker mid-job → stalled → `completed` (NFR-R2);
  - the same job processed twice → one result, no duplicates (NFR-R7);
  - delete during generation → nothing written, worker alive (AC-5.9);
  - a job past its deadline → `failed` with `JOB_TIMEOUT`.
- **PDF fixtures:** valid, scan (no text), scan + free text (warning persisted), encrypted, corrupted, 11 pages, fake `.pdf` → expected codes; `PdfUpload` deleted in every terminal case; no worker crash.
- **SSE:** a reconnect receives a snapshot first; a `completed` event published while disconnected is reflected by the snapshot.
- Limits: role 101 chars, text 20,001 chars, 11 MB file → `400`/`413`, no job created.

## Definition of done
- In the browser: create a CV from a PDF → watch the stages → reload mid-way (same job, AC-5.2) → `ready` (fake content). Works on a second device (AC-5.3).
- Integration tests are green.
- **Docs updated.** CLAUDE.md: BullMQ payload is ids only and `jobId` = DB job id; enqueue only after commit; jobs are at-least-once, so the worker re-checks that the job is active and the CV exists before writing, and results are written whole under a row lock; never block the event loop in the worker; every timeout comes from config; how to run the integration tests. README: job lifecycle and stages, input limits, PDF retention, the `editedPaths` vs `userEdited` decision.
