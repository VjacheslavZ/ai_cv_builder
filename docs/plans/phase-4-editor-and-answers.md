# Phase 4 — Editor, questions, apply answer

**Goal:** the user can edit every field with autosave, answer or skip questions, and see the AI rewrite only the affected section, without ever losing a manual edit and without false "changed elsewhere" conflicts.
**Covers:** FR-8.3–8.6, FR-9 (P0 part), FR-10.1, 10.3, 10.4, 10.6, NFR-R6, NFR-S7, NFR-S9 (answer limit), NFR-M1–M3, M5, M6, M8.
**Depends on:** Phase 3

## Scope

### packages/shared
- [x] `patchCvSchema`: `{ baseVersion, ops: [{ op: 'set', path, value }] }`. Field validators: bullet ≤ 500, URLs only `http(s):` / `mailto:` (no `javascript:`), email/phone formats, dates as `YYYY` / `YYYY-MM` / `present` (AC-10.6). Leave room for `insert`/`remove`/`move` ops (Phase 7).
- [x] `answerSchema`: trimmed, non-empty, ≤ 2,000 chars (AC-8.5).
- [x] `isSimpleField(path)`: contact fields, dates, and proper-noun spellings (`company`, `institution`, `contact.name`) (AC-9.2).

### apps/api — manual editing
- [x] `PATCH /api/cvs/:id`: in one transaction with `SELECT … FOR UPDATE`; if `baseVersion ≠ version` → `409 { code: VERSION_CONFLICT, current }` (AC-10.4). Otherwise apply ops, mark each path `userEdited`, `version + 1` (not `aiRevision`), return `{ version }`.
- [x] **Question lifecycle** (AC-8.6): in the same transaction, open questions whose path is covered by the edited paths → `resolved`.
- [x] Reject invalid ops with `400`, CV unchanged.

### apps/api — questions
- [x] `POST …/questions/:qid/dismiss` → `dismissed` (AC-8.4).
- [x] `POST …/questions/:qid/answer`:
  - Save the answer as `SourceText(kind=answer)` in all cases.
  - **Simple fields** (`isSimpleField`): validate the format and write directly under the row lock; mark the field `userEdited`; `version + 1`; question `answered`; `200` (AC-9.2). Invalid → `400`.
  - **Everything else**: answer limit ≤ 60/hour via `rl:ans:{userId}:{hour}` → `429` (NFR-S9; does not count toward the generation limits). Create `Job(apply_answer, questionId)`, question → `applying`, enqueue after commit, `202 { jobId }` (AC-9.1).

### apps/api — `apply_answer` worker job
- [x] **Per-CV lock** (AC-9.7): `SET lock:cv:{cvId} <token> NX PX <ttl>`; if busy → `job.moveToDelayed(now + backoff, token)` + `throw new DelayedError()`. Release with compare-and-delete (Lua).
- [x] Read the CV, its `aiRevision`, the target section, and the source. **Source = all `SourceText` + the current text of every `userEdited` field** (AC-10.3).
- [x] LLM rewrites only the target section, using the same structured-output + Zod + grounding pipeline as Phase 3, scoped to the section and with the per-job deadline.
- [x] **Id-based merge** (AC-9.3): the prompt includes the section's items **with their ids**, and the output schema requires the id of every existing item it keeps. The server matches items by id; items without an id are new and get fresh UUIDs. The AI cannot delete or reorder `userEdited` items: any that are missing or moved are put back in their original order.
- [x] **Commit with fencing** (NFR-R6): under `SELECT … FOR UPDATE`:
  - if `aiRevision` changed since the job started (another AI change got in, e.g. after the lock expired), discard and retry the job on the new state;
  - otherwise merge the section onto the **current** document, then **restore every `userEdited` field from the current document byte for byte** (this also covers fields edited while the job ran);
  - write new `unverified` questions from grounding for this section, respecting the cap of 10 open questions (AC-8.6);
  - save the pre-change section to `AiSnapshot` (for Phase 7 undo), `version + 1`, `aiRevision + 1`, question → `answered`, job `completed`;
  - after commit, publish `section_updated { path, version }`.
- [x] Permanent failure → CV unchanged, answer kept, question → `failed` (AC-9.5).

### apps/web — editor `/cvs/:id`
- [x] One react-hook-form instance over the `CvDocument`; `useFieldArray` for experience, education, bullets, skills. All inputs are Base UI, wired via `register` / `Controller`. Dates use month/year inputs with a "Present" option.
- [x] **Autosave** (AC-10.1): diff dirty fields into `set` ops; debounce ~1 s, plus flush on `blur` and on `visibilitychange` → hidden (NFR-M5). One request in flight at a time; queue the next. Status "Saving… / Saved / Error" in an `aria-live` region. Keep this logic in a plain module (no React) so it can be unit-tested.
- [x] **AI updates without false conflicts** (AC-10.4): on SSE `section_updated`, refetch the CV, reset the form for that section only, take the new `version` as `baseVersion`, and re-send pending ops automatically if none of them touch the updated section. Highlight the section briefly.
- [x] **Real conflicts** (AC-10.4): a `409` (another device, or pending ops that overlap an AI-updated section) keeps the unsaved local values, loads `current`, shows "This CV was changed elsewhere", and offers "Re-apply my changes" (re-send the kept ops on the new `baseVersion`).
- [x] **Questions panel**: side by side at ≥ 1024 px; a tab or slide-out with an open-question counter on phones (NFR-M2). Each question scrolls to and highlights its field or section. Answer textarea + "Submit" + "Skip". Failed → "Retry". Resolved questions leave the open list.
- [x] A section with an active `apply_answer` job shows "Updating…" and stays read-only; the rest stays editable. Status survives reload because it comes from `GET /api/cvs/:id` (AC-9.4).
- [x] All CV text rendered as React text only, no `dangerouslySetInnerHTML` (NFR-S7).
- [x] Mobile: no horizontal scroll at 360 px, 44 px touch targets, 16 px inputs, `inputmode`/`autocomplete` on contact fields, the answer button not hidden by the keyboard (`dvh`, sticky with safe-area) (NFR-M1, M3, M6). Errors linked via `aria-invalid` / `aria-describedby` (NFR-M8).

## Tests
- **Integration:**
  - a stale `baseVersion` → `409`, CV unchanged;
  - an AI apply racing a manual `PATCH` → both outcomes consistent, `userEdited` bullet byte-identical (AC-9.3, NFR-R6);
  - a manual `PATCH` during an apply does **not** make the apply retry (`aiRevision` unchanged);
  - two quick answers on one section → applied sequentially, both reflected (AC-9.7);
  - an expired lock + concurrent apply → fencing retries, nothing overwritten;
  - the fake LLM drops or reorders a `userEdited` bullet → it is restored in place;
  - email and spelling answers → no LLM call, field marked `userEdited`; invalid email → `400`;
  - a manual edit of a questioned field → the question becomes `resolved`;
  - the 61st answer in an hour → `429`.
- **Unit (api):** the id-based merge and `userEdited` restore; the ops applier; the URL allow-list; `isSimpleField`.
- **Unit (web):** the autosave module — diffing into ops, debounce and flush, one request in flight, rebase after `section_updated` with and without overlapping ops, re-apply after `409`.
- Manually entered "Led a team of 5 engineers" passes grounding in a later apply (AC-10.3).

## Definition of done
- Open a draft on a phone, edit a bullet, answer a "vague" question about the same entry → section updates and is highlighted, the edited bullet is untouched; skipping and the email shortcut both work.
- Typing in Summary while an answer updates Experience shows no conflict message.
- A second tab with a stale version gets the conflict UI without losing typed text.
- **Docs updated.** CLAUDE.md: the AI never changes `userEdited` fields, enforced on the server by id-based merge at commit; every CV write goes through the row lock and bumps `version`; only AI writes bump `aiRevision` (fencing); `apply_answer` takes the per-CV Redis lock; autosave logic lives in a plain module with unit tests.
