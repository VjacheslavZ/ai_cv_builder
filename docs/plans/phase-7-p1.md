# Phase 7 — P1 features

**Goal:** features marked P1 in the SPEC. Each item is independent; build them in the order below.
**Covers:** AC-10.2, AC-12.4.
**Skipped:** items 1 (undo, AC-9.6), 2 (regenerate, FR-13), 5 (local buffer, AC-10.5), and 6 (Playwright P1 part, SPEC §5.4 item 6) are out of scope for this phase.
**Depends on:** Phase 6

Ordered by value to the user:

## 1. Undo the last AI change (AC-9.6) — skipped
_Skipped: not built in this phase._
- [ ] `POST /api/cvs/:id/undo`: under the row lock, restore the section from `AiSnapshot` (one per CV, written in Phase 4) **while still preserving fields that became `userEdited` after the AI change**. Then `version + 1`, `aiRevision + 1`, delete the snapshot, question back to `open`. The answer stays in the source.
- [ ] Web: "Undo" button next to the highlighted section after an AI update; hidden when there is no snapshot.
- [ ] Test: apply → undo → section equals the snapshot; the answer is still in `SourceText`; the question is `open`.

## 2. Regenerate from scratch (FR-13) — skipped
_Skipped: not built in this phase._
- [ ] `POST /api/cvs/:id/regenerate` for a `ready` CV, in one transaction:
  - cancel active `apply_answer` jobs for the CV (`cancelled`; the worker sees it before writing);
  - save the text of every `userEdited` field as `SourceText(kind=manual)`, so facts the user typed survive;
  - create a `generate` job; CV → `generating`; **keep the current document**.
- [ ] Generation success: in the result transaction, replace the document and reset `userEdited` marks, questions, and `AiSnapshot`.
- [ ] Generation failure: keep the previous document, CV back to `ready`, show the reason.
- [ ] Counts toward the generation limits (NFR-S9) and the one-active-generation index.
- [ ] Web: "Regenerate" with a confirm dialog that says manual edits and questions will be reset; the previous CV stays viewable and downloadable while generating.
- [ ] Tests: answers and manual-edit text are in the new source; a failed regenerate keeps the old document; an in-flight `apply_answer` does not write after cancellation; added to the isolation matrix..

## 3. Rename (AC-12.4)
- [x] `PATCH /api/cvs/:id/title` (`renameCvSchema`), 1–100 chars, in any CV status. The title is not part of the document: no `baseVersion`, `version` unchanged, so an open editor never gets a conflict.
- [x] Web: inline rename on the dashboard and in the editor header (`TitleForm`, `useRenameCv`).
- [x] Tests: `apps/api/test/rename.int.test.ts`, a row in the isolation matrix, `renameCvSchema` unit tests.

## 4. Add / remove / reorder (AC-10.2)
- [x] Extend `patchCvSchema` with `insert`, `remove`, and `move` ops addressed by ids (`packages/shared/src/cv/lists.ts`, `applyListOp`). Lists: `experience`, `education`, `skills`, `experience.<id>.bullets`; contact links are out of scope.
- [x] Web: "Add achievement / job / education", a skill input with "Add", "Remove", and reordering by drag and drop with a 44 px handle (SPEC AC-10.2 changed from ↑/↓ buttons: too many buttons per item). `@dnd-kit/react`, one `DragDropProvider` per editor (`SortableLists`), each list its own `type`, so items never move between lists; touch starts after a 150 ms hold, the keyboard sensor stays on, no drop animation. Drop → `useFieldArray.move` + one `move` op (`useListEditor`). Removing a job or an education entry shows a toast with "Undo" (adds it back); bullets and skills go without one.
- [x] Test: ops apply in order; removing an entry resolves questions pointing to it (`editing.int.test.ts`, `apply-ops.test.ts`, `lists.test.ts`, `autosave.test.ts`).
- Decisions: an added or moved item becomes a manual edit (its fields join `editedPaths`), so the AI neither rewrites it nor moves it back. A removed item is remembered in `CvDocument.removed` (list + normalized text) and an AI merge drops new items that match it (exact match after normalization, so a reworded one can slip through); adding the same item again forgets it. Autosave queues ops in order: a field's newer value replaces its queued `set`, list ops are sent at once, a conflict replays the unsaved ops (`overlayUnsaved`).

## 5. Local buffer of unsaved edits (AC-10.5) — skipped
_Skipped: not built in this phase._
- [ ] Persist pending ops to `localStorage` (keyed by CV id + `baseVersion`) until the server confirms them; resend on `online`, on focus, and after re-login. Status "Offline — changes not saved yet".
- [ ] Wrap all storage access in try/catch; the editor must work without storage.
- [ ] On `409` after reconnect, use the same re-apply flow as AC-10.4.

## 6. Playwright, P1 part (SPEC §5.4 item 6) — skipped
_Skipped: not built in this phase._
- [ ] The full flow at 375×667 (iPhone SE).
- [ ] Reload during generation → same job, then the draft opens (AC-5.2).

## Definition of done
- Each item that is not skipped has its test.
- **Docs updated.** README: the new features (rename, list editing); CLAUDE.md: any new commands or invariants.
