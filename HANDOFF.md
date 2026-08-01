# DepoDesk — Session Handoff

_Last updated: 2026-07-27._

**Repo state:** `origin/main` is at **`a7ad8d5`**. Everything below is committed,
pushed, and (where noted) live in Supabase. Working tree clean, nothing unpushed.

Pick up elsewhere: `git pull`, then jump to **Next up**.

---

## Next up (start here)

**Validate the content-search UI against real data.** Built (`90f79dd`) and then
review-fixed (`a7ad8d5`), but still only checked structurally — never exercised
against a real indexed case. When logged in on a case with indexed exhibits:

1. **Search** — type in Contents mode, confirm ranked hits render with the `«…»`
   highlights, the right location label (Library / which deposition), and page count.
2. **Click-to-open** — a hit should navigate to its deposition and open the exhibit.
   Mapping is by `file_path` OR `original_path` (marking moves the indexed original to
   `original_path`), so test a *marked* exhibit too.
3. **Backfill** — on a case with pre-index uploads, the "Index N for search" button
   should appear, index them with progress, then results should include them. Also try
   **Stop** mid-run: it should halt, report "Stopped — N indexed", and leave an
   accurate pending count you can resume from.
4. **Unsearchable case** — open Contents mode on a case that has never synced
   (no session ever started, no file attached). It must say "This case isn't
   searchable yet" and must NOT say "No matches".
5. **Safari** — backfill/indexing reuses `extractPdfText`; run it in real Safari.
   Chromium can't catch the `ReadableStream` class of bug.

If something's off, the UI is in `src/depodesk-search.jsx` (presentational) +
orchestration in `depo-exhibit-app.jsx` (`locateByStoragePath`, the two content-search
effects, `runBackfill` / `cancelBackfill`).

---

## Shipped this session (all pushed)

**Content-search UI + backfill** (`90f79dd`, 2026-07-24) — built on the indexing
plumbing below. New `src/depodesk-search.jsx` renders ranked hits with `«…»`
highlights, location label, page count, and click-to-open; a Name/Contents toggle on
the exhibit-list search box switches between the metadata filter and case-wide
full-text search; old uploads get an "Index N for search" backfill button. **Structurally
verified only — see _Next up_ for the real-data validation still owed.**

**Search review fixes** (`a7ad8d5`, 2026-07-27) — three issues found reviewing the
above:
- **False negative (the important one).** A case with no `remoteId` — never synced to
  Supabase, i.e. never hosted a session and never had a file attached — cleared the
  results and rendered *"No matches for X"*. The search had never run, so mid-deposition
  that reads as "this document isn't in the case." `SearchResults` now takes
  `searchable` and shows *"This case isn't searchable yet"* plus how to fix it; the list
  header reads "Not searchable" instead of a match count.
- The pending/unsearchable tally effect read `activeCase?.remoteId` without depending on
  it, so a case that gained one mid-session kept a stale count until modes were toggled.
- Backfill had no way out: now a **Stop** button, an honest re-tally after a partial run,
  and a "Stopped — N indexed" report.

Verified by rendering `SearchResults` directly against each state (unsynced+query →
not-searchable copy, never "no matches"; genuine no-match still says "no matches";
result row shows name/location/exhibit number/pages with `«…»` as `<mark>`; running
backfill shows progress + Stop).

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
1. **Search UI + backfill** — built (`90f79dd`), review-fixed (`a7ad8d5`); real-data
   validation still owed, see *Next up*.
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
- **Search field scope** — resolved as a Name/Contents toggle: keeps the metadata
  filter AND adds case-wide content search, sharing the one search box. Revisit only
  if you'd rather it fully switch to content search instead of toggling.
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
