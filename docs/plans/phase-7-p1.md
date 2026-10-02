# Phase 7 — P1 features

**Goal:** features marked P1 in the SPEC. Each item is independent; build them in the order below.
**Covers:** FR-13, AC-9.6, AC-10.2, AC-10.5, AC-12.4, SPEC §5.4 item 6 (P1 part).
**Depends on:** Phase 6

Ordered by value to the user:

## 1. Undo the last AI change (AC-9.6)
- [ ] `POST /api/cvs/:id/undo`: under the row lock, restore the section from `AiSnapshot` (one per CV, written in Phase 4) **while still preserving fields that became `userEdited` after the AI change**. Then `version + 1`, `aiRevision + 1`, delete the snapshot, question back to `open`. The answer stays in the source.
- [ ] Web: "Undo" button next to the highlighted section after an AI update; hidden when there is no snapshot.
- [ ] Test: apply → undo → section equals the snapshot; the answer is still in `SourceText`; the question is `open`.

## 2. Regenerate from scratch (FR-13)
- [ ] `POST /api/cvs/:id/regenerate` for a `ready` CV, in one transaction:
  - cancel active `apply_answer` jobs for the CV (`cancelled`; the worker sees it before writing);
  - save the text of every `userEdited` field as `SourceText(kind=manual)`, so facts the user typed survive;
  - create a `generate` job; CV → `generating`; **keep the current document**.
- [ ] Generation success: in the result transaction, replace the document and reset `userEdited` marks, questions, and `AiSnapshot`.
- [ ] Generation failure: keep the previous document, CV back to `ready`, show the reason.
- [ ] Counts toward the generation limits (NFR-S9) and the one-active-generation index.
- [ ] Web: "Regenerate" with a confirm dialog that says manual edits and questions will be reset; the previous CV stays viewable and downloadable while generating.
- [ ] Tests: answers and manual-edit text are in the new source; a failed regenerate keeps the old document; an in-flight `apply_answer` does not write after cancellation; added to the isolation matrix.

## 3. Rename (AC-12.4)
- [ ] `PATCH /api/cvs/:id/title` (or a `set title` op), 1–100 chars.
- [ ] Web: inline rename on the dashboard and in the editor header.

## 4. Add / remove / reorder (AC-10.2)
- [ ] Extend `patchCvSchema` with `insert`, `remove`, and `move` ops addressed by ids.
- [ ] Web: "Add bullet / entry / skill", "Remove", and ↑/↓ buttons (no drag-and-drop), 44 px targets, `useFieldArray` `insert`/`remove`/`move` → autosave.
- [ ] Test: ops apply in order; removing an entry resolves questions pointing to it.

## 5. Local buffer of unsaved edits (AC-10.5)
- [ ] Persist pending ops to `localStorage` (keyed by CV id + `baseVersion`) until the server confirms them; resend on `online`, on focus, and after re-login. Status "Offline — changes not saved yet".
- [ ] Wrap all storage access in try/catch; the editor must work without storage.
- [ ] On `409` after reconnect, use the same re-apply flow as AC-10.4.

## 6. Playwright, P1 part (SPEC §5.4 item 6)
- [ ] The full flow at 375×667 (iPhone SE).
- [ ] Reload during generation → same job, then the draft opens (AC-5.2).

## Definition of done
- Each item has its test.
- **Docs updated.** README: the new features (undo, regenerate, rename, list editing, local buffer) and how to run the Playwright suite; README Decisions: how regenerate keeps facts and the previous document; CLAUDE.md: any new commands or invariants (e.g. undo and regenerate preserve user-typed facts).
