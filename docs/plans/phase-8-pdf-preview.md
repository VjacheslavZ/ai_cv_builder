# Phase 8 — Live PDF preview and the three-column editor

**Goal:** on a desktop, the user sees the PDF they will download while they edit. The editor page becomes three columns: preview | editor | rail (status, download, questions).
**Covers:** AC-11.7, NFR-M2 (desktop layout), NFR-S9 (preview limit), SPEC v1.2.
**Depends on:** Phase 7 (list editing, the editor as it is now).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Column order (≥ 1024 px) | Preview 45% \| editor 45% \| rail 10%, left to right | Agreed with the user. |
| What the preview is | The real PDF from the server (`CvExportService` + `CvPdfRenderer`), shown in an `<iframe>` by the browser's built-in viewer | What you see is exactly what downloads. NFR-M7 forbids client PDF libraries (no pdf.js), and the renderer already runs in a `worker_thread` with a timeout. |
| What is previewed | The **saved** document only (same rule as the download, AC-11.3) | One source of truth; no second rendering path that could drift. Unsaved typing shows up once autosave settles. |
| "Chat" column | The existing questions panel (FR-8, FR-9), no new AI logic | Agreed with the user. A free-form chat would be a separate phase. |
| Rail width | 10% (min ~7 rem) holds the CV status, the save status, "Download PDF", and "Questions (n)"; the panel itself opens as a non-modal drawer (~24 rem) over the preview | ~140 px is too narrow to answer questions; non-modal so the editor stays usable while a question is open. |
| Phones and tablets (< 1024 px) | Unchanged: one column, CV / Questions tabs, no preview, no preview requests | SPEC decision 15. |

## 1. API: preview endpoint

- [ ] `GET /api/cvs/:id/pdf/preview`: same checks and rendering as `GET /api/cvs/:id/pdf` (owner only → `404`, no document → `409 CV_NOT_EDITABLE`, the **saved** document read from Postgres on every request), with:
  - `Content-Type: application/pdf`, `Content-Disposition: inline` (no file name needed), `Cache-Control: no-store`;
  - framing allowed for the web origin only: `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on **this route only**, overriding the global helmet `'none'` / `DENY` (`bootstrap/configure-app.ts`). `'self'` works because the browser loads it through the same-origin `/api` rewrite.
- [ ] The export endpoint is unchanged: `attachment`, `frame-ancestors 'none'`, `DENY`.
- [ ] Preview limit (NFR-S9): `PDF_PREVIEWS_PER_MINUTE` in `env.schema.ts` (default 30), a Redis counter `rl:pdfp:{userId}:{minute}` (`INCR` + `EXPIRE`) next to `GenerationLimits` → `429 RATE_LIMITED`; Redis down → `503` (never unlimited). Checked before rendering.
- [ ] Logs: `cvId`, `durationMs`, `bytes`, `preview: true`. No CV text.
- [ ] Tests (`apps/api/test/pdf-preview.int.test.ts`): `inline` and the framing headers; the export route keeps `attachment` and `'none'`; a document saved after the first preview is in the next one (text extracted with the existing PDF test helper); `409` before the first draft; `429` past the limit and the download still works; a `GET pdf preview` row in the isolation matrix.

## 2. Web: framing

- [ ] `next.config.ts` sends `frame-ancestors 'none'` on every path, `/api/*` included, and two CSP headers are both enforced. Exclude `/api/cvs/:id/pdf/preview` from that header (source pattern with a negative lookahead) so the API's `'self'` is the only rule there. Every other path keeps `'none'`.
- [ ] Check in Chrome, Firefox, and Safari (desktop) that the frame loads and that framing the preview from another origin is refused.

## 3. Web: preview pane

- [ ] `lib/pdf-preview.ts` (plain module, unit-tested, no React): decides **when** to load which version.
  - Input: the saved `version` (autosave state, which also moves on AI updates via `rebase`) and the autosave status.
  - Load only when the status is `saved` / `idle` and nothing changed for `PREVIEW_SETTLE_MS` (~1.5 s, a web constant); never while `pending` / `saving` / `conflict`.
  - One load in flight; a newer version that arrives meanwhile is loaded right after; an older one is never shown over a newer one.
  - Stops on `429` until the next minute, and on a render error until the next version.
- [ ] `components/cv/editor/pdf-preview.tsx`: two stacked `<iframe>`s, double-buffered: the new version loads in the hidden one and is swapped in on `load` (fallback timeout if a browser never fires `load` for a PDF), so the old page stays visible meanwhile. `src` = `/api/cvs/:id/pdf/preview?v=<version>#view=FitH`. A small "Updating preview…" / "Preview paused" line (`aria-live="polite"`); a `title` on the iframe for screen readers.
- [ ] Rendered only at ≥ 1024 px (a media-query hook, not CSS `hidden`), so phones never request a preview.
- [ ] Known limit: the built-in viewer goes back to page 1 on every reload. Accepted for now; noted in the README.

## 4. Web: three-column layout and the rail

- [ ] `CvEditor` at ≥ 1024 px: `grid-cols-[minmax(0,45fr)_minmax(0,45fr)_minmax(7rem,10fr)]`, full viewport height below the page header (`dvh`); the preview and the rail are sticky, the editor column scrolls.
- [ ] `editor-rail.tsx`: the CV status badge, `SaveStatus` (already `aria-live`), "Download PDF" (icon above a short label), "Questions" with the open-question counter. Buttons ≥ 44 px.
- [ ] `questions-drawer.tsx`: the existing `QuestionsPanel` in a non-modal Base UI dialog sliding in from the right over the preview (~24 rem); Escape and a close button close it; focus moves in on open and back to the "Questions" button on close. Answering, skipping, and "show in CV" behave as today.
- [ ] Below 1024 px: today's layout (tabs, toolbar with status and download).
- [ ] Components stay around 150 lines: the layout, rail, drawer, and preview are separate files; the decision logic stays in `lib/pdf-preview.ts`.

## 5. Docs

- [ ] README: the live preview (desktop only), the three columns, the known page-1 reset, the preview limit setting.
- [ ] CLAUDE.md: the preview route is the only `inline` and frameable response; framing headers are set per route and excluded in `next.config.ts`; the preview renders the saved document like the export; no client-side PDF libraries.
- [ ] `docs/plans/testing.md`: the new suite and the manual checks below.

## Manual checks

- Chrome, Firefox, Safari at 1024 and 1440 px: the preview shows the CV; it refreshes after typing (once saved), after add / remove / move, and after an AI answer; a long CV shows several pages.
- No flicker: the previous version stays until the new one is loaded.
- 375 px: no preview column and no `/pdf/preview` request in the network log.
- Open the preview URL in a page on another origin: the browser refuses to frame it.

## Definition of done
- Each item above has its test or its manual check written down.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- **Docs updated:** README, CLAUDE.md, `testing.md`, this plan's checkboxes.
