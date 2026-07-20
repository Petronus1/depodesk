# DepoDesk

Deposition exhibit management for a solo law practice (Ryan Peterson,
ryan@peterson.legal). Attorneys organize cases → depositions → exhibits,
then run live deposition sessions where witnesses, opposing counsel, and
court reporters join by PIN from their own browsers and see exhibits
pushed in real time. Every session produces an audit trail exportable to
PDF.

## Stack & layout

React 19 + Vite, plain JS (no TS), inline styles (no CSS framework).
Backend is entirely Supabase: Postgres + RLS, Storage, Realtime,
Auth. Deployed on Vercel (auto-deploys from `main` on GitHub:
`Petronus1/depodesk`).

- `src/App.jsx` — router by pathname: `/join`, `/witness`,
  `/opposing-counsel`, `/court-reporter`, else attorney app (auth-gated;
  anonymous sessions are bounced to the sign-in screen)
- `src/depo-exhibit-app.jsx` — main attorney app (cases/depos/exhibits
  panels, sessions, sharing, annotations)
- `src/depodesk-supabase.js` — all Supabase access + `useAuth` and
  the `privateChannel()` helper + `logSessionEvent`
- `src/depodesk-join.jsx` — PIN join flow (anonymous sign-in happens here)
- `src/depodesk-witness.jsx`, `-opposing-counsel.jsx`,
  `-court-reporter.jsx` — participant views (admission-gated)
- `src/depodesk-pdfviewer.jsx` — shared PDF viewer (pdfjs-dist), page
  sync host→witness, rotate control, white canvas background, and
  witness markup: host starts/saves/discards from the toolbar, witness
  draws (page-normalized strokes), strokes stream live on the
  `annotate:<session id>` private topic (the ONLY topic approved
  participants may send on)
- `src/depodesk-session-panel.jsx` — floating live-session panel
  (participants passed in as a prop from the app's poll)
- `src/depodesk-session-history.jsx` — 🕓 History modal: per-session
  audit trail + print-dialog PDF export + post-deposition ZIP package
  (cover index, generated audit PDF, and marked exhibit files)
- `src/depodesk-stamp.js` — burns the court-reporter exhibit sticker
  (yellow, "EXHIBIT" + case-wide number, no date — exhibits are reused
  across depos) onto page 1 at mark time; stamped copy becomes
  `file_path`, original kept as `original_path`. Also `flattenMarkup`:
  burns saved witness strokes into the PDF; the result is added as a
  NEW exhibit "<name> — as marked by witness" in the deposition.
  Both assume unrotated pages (v1 limitation).
- `src/depodesk-schema.sql` — AUTHORITATIVE schema (rebuilt from prod
  introspection; keep in sync when changing the DB)
- `src/depodesk-rls-migration.sql`, `src/depodesk-realtime-migration.sql`
  — applied migrations, kept for the record

## Data model (key points)

- Attorney data (`cases`, `exhibits`, `annotations`) is owner-scoped by
  RLS. BUT the attorney app's working data lives in **localStorage**
  (`depodesk-cases-v2` etc.) with local ids like `"case-1752…"`. A
  Supabase `cases` row is created lazily on first session start
  (`ensureRemoteCaseId`), and the mapping is stored as `remoteId` on the
  local case. Never pass local ids where a UUID is expected.
- Storage paths are `<case_uuid>/<exhibit_id>.<ext>` in the private
  `exhibits` bucket; policies match the folder to an owned/member case
  (`can_access_case_files`), reads also allow approved participants of
  an active session (`can_read_case_files`).
- Exhibit `fileUrl` is a transient blob/signed URL; the durable pointer
  is `file_path`. Selecting an exhibit rehydrates a signed URL.
- `sessions` have `pin` (6-digit, unique among active), `controller_role`,
  and `case_id`. `participants` carry `status`
  (pending/approved/rejected) and `auth_uid` (anonymous auth identity).
- `session_events` is the audit trail. `exhibit_id` there is a uuid FK —
  local numeric exhibit ids must NOT be written to it (logSessionEvent
  guards this); use `exhibit_name`/`exhibit_num`.

## Security model (do not regress)

- Anon key ships in the bundle; **tables `sessions`, `participants`,
  `session_events` are host-only**. Unauthenticated participants use
  SECURITY DEFINER RPCs, treating their participant UUID as a bearer
  credential: `join_session_by_pin`, `request_to_join`,
  `get_participant_state`, `get_session_for_participant`,
  `get_session_events`.
- Participants sign in **anonymously** on /join ("Allow anonymous
  sign-ins" is enabled in Supabase Auth). Their `auth.uid()` is recorded
  on the participant row and drives realtime + storage read access.
- **All broadcast channels are private** (`privateChannel()` — topics
  `session:<id>`, `pdf-sync:<id>`, `reporter:<id>`). RLS on
  `realtime.messages`: hosts send/receive, approved participants
  receive. The SessionPanel `participants:<id>` postgres_changes channel
  stays public (no broadcasts, table RLS applies).
- Gotcha that bit us twice: **RLS policy subqueries run as the caller**,
  so policies referencing host-only tables must use SECURITY DEFINER
  helper functions, and `INSERT … RETURNING` needs a select policy —
  that's why joining is an RPC.

## Operational notes

- Supabase project: `jxpsqttphsccbigeppfg.supabase.co`, **free tier** —
  pauses after ~1 week idle (symptom: NXDOMAIN / "Load failed"; restore
  from the dashboard). A GitHub Actions keep-alive
  (`.github/workflows/supabase-keepalive.yml`) pings Mon/Thu.
- Schema changes: I can't run SQL — write a migration file, Ryan pastes
  it into the Supabase SQL Editor and reports results. Make migrations
  idempotent; include a verification `select` at the end. Update
  `depodesk-schema.sql` to match afterward.
- Dev server: `npm run dev` (port 5173, `.claude/launch.json` exists).
  Participant flows (join/witness/etc.) are testable without attorney
  credentials; the attorney app is behind Ryan's login — hand him the
  interactive steps.
- Git: pushes to `main` deploy to Vercel. Commit author is
  `Ryan Peterson <ryan@peterson.legal>`.

## Known gaps / backlog

- PIN brute-force hardening (6 digits, anon-callable lookup).
- Periodic purge of anonymous auth users (query in schema file).
- `/reset-password` route missing (forgot-password emails dead-end).
- Reuse one subscribed channel per session instead of per-send
  `privateChannel()` instances; revoke blob object URLs.
- Pre-existing lint: conditional `useCallback` after the `isWitness`
  early return in depo-exhibit-app.jsx (harmless, `isWitness` is stable).
- Package exports for sessions created before `depodesk-package-migration.sql`
  include the cover and audit PDFs but cannot recover historical exhibit
  files, because their storage paths were not captured in audit events.
