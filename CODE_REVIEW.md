# DepoDesk — Code Review

_Reviewed 2026-07-22. Scope: full pass — structure, correctness, and security._

This is a well-built and unusually well-documented codebase for a solo project.
The Supabase security model in particular is coherent and defensible. The items
below are the findings that were **not** auto-fixed in this pass; the quick wins
(dead legacy functions, the conditional-hook lint error, and a handful of unused
variables) were already applied.

Findings are ordered by priority. Nothing here is on fire.

---

## 1. PIN brute-force leaks case captions — _highest priority_

> **Partially resolved 2026-07-22 (`3f2a4b1`).** The caption disclosure is
> fixed: `join_session_by_pin` now returns only the session id + pin, and the
> join details step no longer shows the caption pre-admission (see
> `depodesk-pin-caption-migration.sql` — **must be run in the Supabase SQL
> Editor** to take effect). Still open: shrinking the brute-force surface
> itself — longer/alphanumeric PINs and server-side rate limiting / lockout.

**Where:** `join_session_by_pin` (RPC in `depodesk-schema.sql`), called from
`depodesk-join.jsx`.

**What:** The RPC is granted to `anon` and returns the case **name and number**
for any valid 6-digit PIN — before the participant is admitted by the host. The
PIN space is only 900,000 and is rate-limited solely by Supabase's defaults.

**Why it matters:** For a legal product, the case caption *is* confidential —
it contains the party names. A script hitting the RPC could enumerate active
sessions and harvest client/matter names without ever being admitted. This is
already logged as a backlog item ("PIN brute-force hardening"), but the caption
disclosure makes it a confidentiality issue rather than a nuisance, so it
deserves a higher priority than its current framing.

**Options (any one helps; combining is better):**
- Don't return the caption from `join_session_by_pin`. Return only whether the
  PIN is valid + the session id; fetch the caption later via
  `get_session_for_participant`, which already gates on `status = 'approved'`.
- Lengthen the PIN (8–10 digits) or make it alphanumeric.
- Add server-side rate limiting / lockout on repeated failed PIN lookups
  (e.g. a `pin_attempts` table keyed by IP or anon `auth.uid()`, checked inside
  the RPC).

---

## 2. Redundant / stale Supabase credentials

**Where:** `.env`, `depodesk-supabase.js:13-14`.

**What:** The anon (publishable) key is committed in `.env` **and** hardcoded in
`depodesk-supabase.js`. `import.meta.env` is never referenced anywhere in the
codebase, so `.env` is entirely vestigial — and its value
(`eyJsb_publishable_…`) doesn't even match the hardcoded one
(`sb_publishable_…`).

**Why it matters:** Low security risk — the publishable key is public by design
and ships in the bundle regardless. This is a maintainability / hygiene issue:
two sources of truth, one of them wrong, is a future foot-gun.

**Suggested:**
- Pick one source. If you keep `.env`, read it via
  `import.meta.env.VITE_SUPABASE_ANON_KEY` and delete the hardcoded literal.
- Add `.env` to `.gitignore` and commit a `.env.example` with placeholder values.
- Delete the stale "Replace SUPABASE_URL and SUPABASE_ANON_KEY below" setup
  comment at the top of `depodesk-supabase.js`.

---

## 3. Exhibit numbering can race

**Where:** `markExhibit` in `depo-exhibit-app.jsx`.

**What:** The next exhibit number is computed from a React state snapshot
(`Math.max(...allMarked) + 1`), followed by several sequential `setState` calls
with `await`s between them. Two marks in quick succession would read the same
snapshot and assign the **same** exhibit number.

**Why it matters:** It's human-paced during a live deposition, so the probability
is low — but duplicate exhibit numbers in a court record are exactly the kind of
error that's very costly when it does occur.

**Options:**
- Derive the number authoritatively server-side (a small RPC that increments a
  per-case counter atomically), rather than from client state.
- At minimum, guard against concurrent marks in the UI (disable the mark button
  while a mark is in flight).

---

## 4. Structure & maintainability

- **`depo-exhibit-app.jsx` is ~1,640 lines** and owns cases, depositions,
  exhibits, sessions, sharing, annotations, and stamping. It's the clear
  candidate to split — e.g. pull the session/sharing logic and the annotation
  layer into their own modules.
- **Duplicated theme constants.** `GOLD`, `NAVY`, `DARK`, `BORDER`, `MUTED`,
  `DIM` are redefined in at least four files (`depodesk-join`, `depodesk-auth`,
  `depodesk-pdfviewer`, `depo-exhibit-app`). Extract a single `theme.js` and
  import from it.
- **`storageGet` / `storageSet` / `storageDel`** are declared `async` but do
  purely synchronous `localStorage` work. Harmless, but the `async` signature is
  misleading — either make them sync or leave a comment noting the shape is
  intentional for a possible future async backend.

## 5. Tests

There are no tests anywhere. For a tool producing court-ready audit records, a
small suite would pay for itself quickly. Highest-value targets:

- Exhibit numbering (`markExhibit`) — including the concurrency case in #3.
- The `isUuid` guard in `logSessionEvent` (local numeric ids must never reach
  the `exhibit_id` uuid FK).
- `sanitizeCases` (must null transient `fileUrl`s but preserve `file_path`).

## 6. Minor lint residue (left intentionally)

After this pass the linter reports **0 errors, 20 warnings**. The remaining
warnings are:

- **`react-hooks(exhaustive-deps)`** on the polling/broadcast effects. Most are
  deliberate — the effects intentionally use narrow dependency arrays to avoid
  re-subscribing. Worth an eventual audit, but not a bug today. One to keep an
  eye on: the OC-ingest effect in `depo-exhibit-app.jsx` doesn't list
  `activeSession.localCaseId` / `localDepoId`, so it won't re-bind if those
  change mid-session (fine under current single-session usage).
- **3× `catch (err)` unused parameters** — cosmetic; can be changed to bare
  `catch {}` whenever convenient.

---

## Already fixed in this pass

- Removed dead legacy session functions (`startSession`,
  `pushExhibitToWitnesses`, `subscribeToSession`, `endSession`,
  `getSessionByToken`) that predated the host-only RLS lockdown and would fail
  for anonymous callers.
- Fixed the one hard lint error: the conditional `useCallback` (`onDrop`) after
  the `isWitness` early return is now a plain function; removed the now-unused
  `useCallback` import.
- Cleared unused variables: `DARK` and `toggleBtn` (`depodesk-pdfviewer`),
  `hasAnnotations` (`depo-exhibit-app`), `participant`/`setParticipant`
  (`depodesk-opposing-counsel`); underscore-prefixed the reserved
  `onPageChange` prop and the unused `depositionId` parameter.
