# Phase 5 — PDF export & retry

**Goal:** the user can download a correct A4 PDF of the latest saved version from any device, and can recover from a failed generation.
**Covers:** FR-11, AC-5.6 (retry), AC-8.3 (export with open questions), NFR-R4 (render timeout), NFR-M7 (no client-side PDF).
**Depends on:** Phase 3 (can run in parallel with Phase 4)

Regenerate (FR-13) is P1 in SPEC v1.1 and moved to [Phase 7](phase-7-p1.md).

## Scope

### apps/api — PDF
- [ ] **Renderer decision:** `@react-pdf/renderer` (recommended: automatic page flow and wrapping, AC-11.4) vs `pdfkit` (no JSX build step in Nest, manual pagination). Decide before starting the layout; if JSX in the Nest build gets in the way, use `React.createElement` without JSX rather than switching.
- [ ] Embed one font family with Latin Extended + Cyrillic (e.g. Noto Sans / Inter, regular + bold, `.ttf` committed under `apps/api/assets/fonts`) (AC-11.4).
- [ ] Layout: A4 595×842 pt, margins ≥ 15 mm (≥ 43 pt). Name, contact line, Summary, Experience, Education, Skills. Dates rendered from the structured form (`Jan 2020 – Present`). Text only: no HTML, links only `http(s)` / `mailto` (NFR-S7).
- [ ] **Empty-field omission** (AC-11.5, AC-8.3): no empty lines, no heading for an empty section, no placeholders.
- [ ] Rendering must not block the API event loop for long: keep it under the 10 s timeout (NFR-R4), and if profiling shows long renders, move it to a `worker_thread`.
- [ ] `GET /api/cvs/:id/pdf`: ownership check; the CV must have a document (`ready`, or `generating` during a P1 regenerate, which keeps the previous document); render from the **saved** document; `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<Full_Name>_CV.pdf"` with an RFC 5987 `filename*` for non-ASCII names (AC-11.1, AC-11.6). Fallback name `CV.pdf` when the name is empty.

### apps/api — retry
- [ ] `POST /api/cvs/:id/retry` (AC-5.6): only for `failed`; a new `generate` job on the **saved** source (no re-upload). If the job failed before extraction, reuse the `PdfUpload` while it still exists; if it is gone (24 h retention), respond with a clear error asking to upload again. Respects the one-active-job index and the generation limits (NFR-S9).

### apps/web
- [ ] "Download PDF": first **flush autosave and wait** for it to finish (AC-11.3), then navigate to the PDF URL. Use a plain navigation or `<a href>` rather than a blob, so iOS Safari / Android Chrome open the native viewer (AC-11.6). No client-side PDF libraries (NFR-M7).
- [ ] "Retry" on failed CVs (dashboard and progress screen) and on failed questions (Phase 4 button wiring).

## Tests
- PDF integration: page size is 595×842; `pdftotext` / pdf.js extraction contains the name, all non-empty section headings, and bullets in order (AC-11.2); a long CV spans multiple pages without truncation; `é ü ł` and a Cyrillic name are extractable; no "Education" heading when education is empty.
- Headers: `Content-Type`, `Content-Disposition` with a non-ASCII name.
- Freshness: `PATCH` then immediate `GET pdf` → the new text is present.
- Retry on `failed` reuses the saved source; retry after a pre-extraction failure reuses the PDF bytes; retry after retention expiry returns the "upload again" error.
- Web unit: "Download PDF" waits for the pending autosave before navigating.

## Definition of done
- Download works on desktop and on a phone (or the mobile emulator) for a CV with open questions and a Cyrillic name.
- Retry leads from `failed` back to a `ready` draft.
- **Docs updated.** CLAUDE.md: where the PDF template and fonts live; the PDF is rendered only from the saved document. README Decisions: the renderer choice.
