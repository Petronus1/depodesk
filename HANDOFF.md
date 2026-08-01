# DepoDesk — Session Handoff

_Last updated: 2026-07-27._

**Repo state:** `origin/main` is at **`6a606ad`**. Everything below is committed,
pushed, and (where noted) live in Supabase. Working tree clean, nothing unpushed.

Pick up elsewhere: `git pull`, then jump to **Next up**.

**Run the tests first:** `npm test` (42 tests, Vitest). If they're green, the pure
logic is sound and any problem is in browser-only territory — realtime, RLS, pdfjs,
or the UI.

---

## Next up (start here)

**Nothing is half-finished — pick any open item below.** Content search is validated
and there's now a test suite. The biggest remaining piece is the **session/sharing
extraction** (Open items #3); the smaller ones are listed there too.

Two small paths never exercised, if you want to close them out first:
- **Unsearchable-case copy** — open Contents mode on a case that has *never* synced
  (no session started, no file attached). Should read "This case isn't searchable yet",
  never "No matches". (Logic verified by direct render, not in the live app.)
- **Backfill Stop** — the cancel path. The 8-exhibit backfill ran to completion, so
  Stop mid-run was never clicked.

**When you add tests**, one lesson worth repeating: the first regression test written
for the `label === null` crash *passed against the buggy code*. The query used
(`"business"`) matched the exhibit's **name**, which short-circuits before `label` is
read — the real crash needs a term that does NOT match the name. It was only caught by
deliberately reverting the fix to confirm the test failed. **A test you haven't watched
fail isn't yet a test.**

---

## Test suite (`6a606ad`, 2026-07-27)

`npm test` — Vitest, 42 tests, ~0.5s. Chosen for consequence, not coverage %:
the exhibit-list filter guards (the crash below), case-wide exhibit numbering
(never reuses a gap — an old number may already be in a transcript), `isUuid`
(rejects the app's numeric / `oc-` / `-stamped` ids that would fail the
`session_events` FK and silently lose an audit event), `sanitizeCases`,
`highlightSnippet`, and the searchable/not-searchable decision in
`normalizeExtractedText` (scans and stray OCR artifacts must read as NOT
searchable).

To make that logic testable, three pieces moved out of `depo-exhibit-app.jsx`
into pure functions in `depodesk-store.js` (`matchesExhibitQuery`,
`nextExhibitNumber`, `usedExhibitNumbers`), and `normalizeExtractedText` was
split out of `extractPdfText`. Behaviour-preserving; re-verified in the live app.

**Deliberately not unit-tested: `extractPdfText` itself.** pdfjs is
browser-targeted (needs DOMMatrix, a worker), and — the real reason — a Node test
would *not* have caught the Safari `ReadableStream` bug, because Node's support
differs. That class of bug only surfaces in the real browser. Don't add a Node
pdfjs test expecting it to protect you there.

---

## Validated 2026-07-27 (real data, Safari)

Content search now works end to end against a real indexed case:
- **Search** returns ranked hits from document text.
- **Click-to-open** navigates to the exhibit and opens it.
- **Backfill** indexed 8 pre-existing exhibits, which then appeared in results — also
  the first time `extractPdfText` ran in bulk in Safari, confirming the
  `ReadableStream` fix under real load rather than a synthetic PDF.

Two bugs fixed along the way:
- **App-wide crash (`8e2c50a`)** — the exhibit-list filter called
  `e.label.toLowerCase()` unguarded, but an unmarked exhibit has `label === null`. So
  typing *anything* in the search box white-screened the app whenever the list held an
  unmarked exhibit (i.e. any newly added one). **Pre-existing**, unrelated to search:
  `filtered` recomputes every render regardless of mode. It escaped all prior testing
  because every `SEED_CASES` exhibit has a label — only user-created ones are null.
- **Error boundary (`aa3c7ba`)** — a render crash used to blank the entire app, which
  is unacceptable mid-deposition and hid the cause. Now shows the error + component
  stack with a Reload. It paid for itself immediately: it pinpointed the crash above
  to an exact line after console debugging in Safari had stalled.

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
1. ~~**Search UI + backfill**~~ ✅ built (`90f79dd`), review-fixed (`a7ad8d5`),
   validated against real data 2026-07-27. Only the two small paths in *Next up*
   remain unexercised.
2. ~~**Tests**~~ ✅ Vitest suite added (`6a606ad`) — see the section below. Worth
   extending as new pure logic appears; the obvious remaining gap is the
   *stateful* paths that still live inside the component (marking's concurrency
   guard, renumber's re-stamp-then-commit ordering). Those need either a
   state-lift (see #3) or component tests with a DOM environment.
3. **Session/sharing extraction** — the deferred half of the split, and now the
   biggest single item. Deeply coupled to exhibit/case state (95 refs;
   `shareExhibit` alone reads 8 App-local things), so it needs a real state-lift
   and a live two-party test, not a tack-on. Doing it would also make the
   stateful logic in #2 testable.

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
- Run: `npm run dev` · `npm test` (Vitest) · `npm run lint` (oxlint) · `npm run build`
- Supabase project `jxpsqttphsccbigeppfg` — migrations in `src/*-migration.sql`, run
  in the SQL Editor (idempotent). Storage deletes go through the Dashboard/API, not SQL.
- Architecture + security model: `CLAUDE.md`. Older findings: `CODE_REVIEW.md`.
