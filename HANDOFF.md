# DepoDesk — Session Handoff

_Last updated: 2026-07-24._

**Repo state:** `origin/main` is at **`ea3f45b`**. Everything below is committed,
pushed, and (where noted) live in Supabase. Working tree clean, nothing unpushed.

Pick up elsewhere: `git pull`, then jump to **Next up**.

---

## Next up (start here)

**Finish full-text search.** Indexing works and is verified; the UI that uses it
does not exist yet. Two pieces remain:

1. **Search UI** — case-wide results panel. The plumbing is already built and
   tested: `searchExhibitText(caseId, query)` in `src/depodesk-fulltext.js` calls
   the `search_exhibit_text` RPC and returns
   `[{ storage_path, exhibit_name, page_count, snippet, rank }]`, ranked, with
   `«…»`-delimited highlights. Needs: a results view (which deposition/library each
   hit lives in, snippet, click-to-open), and a way to switch between today's
   metadata filter and content search. Also surface
   `getUnsearchableExhibits(caseId)` in the results footer ("N exhibits couldn't be
   text-searched") so a negative result stays trustworthy.
2. **Backfill** — exhibits uploaded before 2026-07-24 have no `exhibit_text` row, so
   they're invisible to content search. Needs a one-time pass: for each exhibit with
   a `file_path`, fetch → `extractPdfText` → upsert. Could be a hidden button or a
   run-once-on-load routine.

---

## Shipped this session (all pushed)

**Full-text indexing** (`ea3f45b`) — text is extracted in the browser with pdfjs
(already a dependency; no server compute, nothing leaves Supabase) and upserted into
a new `exhibit_text` table keyed by `(case_id, storage_path)`, with a Postgres FTS
index and RLS mirroring case ownership. **Participants get no access** — extracted
text is attorney work product. Migration `src/depodesk-fulltext-migration.sql` is
**already applied in prod**. Indexing status is stored on the exhibit and shown
persistently under its name: _Searchable · N pages_ / _no text layer_ / _failed +
reason_.

Two real bugs fixed while testing it:
- **The "+ Exhibit" modal never uploaded to Supabase.** Files stayed local blobs
  until the exhibit happened to be shared or marked — invisible on other devices and
  nothing to index. Both entry points now share one `uploadAndIndex` helper.
- **Safari:** pdfjs `getTextContent()` async-iterates a `ReadableStream`, which
  Safari doesn't implement (`undefined is not a function (near '...value of
  readableStream...')`). Now reads via `getReader()`. **Test in Safari** — Chromium
  cannot catch this class of bug.

**OC observer mode** (`2dbe9cb`) — opposing counsel's view of a host-pushed exhibit
now uses the pdfjs `PDFViewer` in a read-only `mode="observer"`: follows the host's
`force_page` (one "Direct witness" click moves witness *and* OC), never subscribes to
markup. Confirmed working live.

**Renumber hardening** (`e5601fa`) — `exhibit_renumbered` carries `exhibit_id` and the
OC roster matches on it (not name+number); re-stamps upload to a versioned path so a
live participant's signed URL can't serve a cached old number.

**`depo-exhibit-app.jsx` split** (`157939f`, `0c34220`, `5944c29`) — 1,772 → 1,315
lines via three verbatim extractions: `depodesk-annotations.jsx` (attorney markup
layer), `depodesk-panels.jsx` (CasesPanel/DepositionsPanel/ImportSelector),
`depodesk-store.js` (localStorage keys/helpers, `sanitizeCases`, `SEED_CASES`).

---

## Open items

**Big, standalone:**
1. **Search UI + backfill** — see *Next up*.
2. **Tests** — none exist. Highest value: exhibit numbering (concurrency guard +
   renumber), `isUuid` in `logSessionEvent`, `sanitizeCases`, and now
   `extractPdfText`.
3. **Session/sharing extraction** — the deferred half of the split. Deeply coupled to
   exhibit/case state (95 refs; `shareExhibit` alone reads 8 App-local things), so it
   needs a real state-lift and a live two-party test, not a tack-on.

**Smaller:**
- Renumber's duplicate-number check uses a native `confirm()`; a modal would be nicer.
- OC roster live-update after renumber is logic-verified; wants a two-party session.
- Realtime: participant views subscribe inside an async `connect()` → StrictMode (dev)
  can double-subscribe (dedup-guarded; proper fix is a per-effect `cancelled` flag).
  Reuse one channel per session; revoke blob object URLs.
- Periodic purge of anonymous auth users (query in the schema file).
- Pre-`depodesk-package-migration.sql` sessions can't recover historical exhibit files
  in package exports (storage paths weren't captured in audit events).
- Residual PIN risk: distributed IP-rotating attacker (bounded by Supabase limits +
  the admission gate).
- ~20 intentional lint warnings (mostly deliberate `exhaustive-deps`).

**Wants your input:**
- **Search field scope** — decided: case-wide content search with a results panel
  (above). Open sub-question: should the box also still filter the current list by
  name/tag, or fully switch to content search?
- OCR: you said your paralegal can OCR before upload. That's what makes scans
  searchable — nothing in the app does OCR.

---

## Environment notes (bit us this session)

- **Safari's Cmd-Shift-R is Reader mode**, not hard reload. Hard reload is
  **Cmd-Option-R**. Two "unstyled app" screenshots were just Reader mode.
- Dev server: `npm run dev` (Vite, port 5173). If Claude also has one running, yours
  may land on 5174 — a different origin, so you'll be signed out there.
- Claude's browser pane is Chromium-based and **unauthenticated**; it cannot see
  RLS-protected rows. To check `exhibit_text` etc., use the Supabase **Table Editor**,
  not a query from Claude.

## Quick reference
- Repo: `github.com/Petronus1/depodesk` · branch `main`
- Run: `npm run dev` · `npm run lint` (oxlint) · `npm run build`
- Supabase project `jxpsqttphsccbigeppfg` — migrations in `src/*-migration.sql`, run
  in the SQL Editor (idempotent). Storage deletes go through the Dashboard/API, not SQL.
- Architecture + security model: `CLAUDE.md`. Older findings: `CODE_REVIEW.md`.
