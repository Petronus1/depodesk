# DepoDesk — Status (2026-07-19)

Point-in-time snapshot at the end of the July 18–19 working sessions.
CLAUDE.md remains the evergreen project reference; this is the "where
are we" summary.

## Current state: stable, deployed, nothing in flight

- Live at **https://depodesk.vercel.app** (auto-deploys from `main` on
  GitHub `Petronus1/depodesk`; latest commit `390557c`).
- Backend: Supabase project `jxpsqttphsccbigeppfg`, free tier, all
  migrations applied and verified in production.
- No uncommitted work. No pending SQL. All test data cleaned up.

## What shipped in these sessions

**Stability & correctness**
- Fixed infinite startup spinner (auth check no longer blocks on network)
- Fixed persistence (was writing to a nonexistent API; now localStorage)
- Fixed session panel never rendering (was trapped inside a CSS string)
- Fixed witness-view crash, session lost on refresh, stale "0 connected"
- Files survive refresh (signed-URL rehydration from `file_path`)
- PDF viewer: white canvas background, rotate control, render-race fix
- Removed hardcoded test credentials from signup + real form validation
- Removed vestigial Type dropdown from Add Exhibit

**Security (full lockdown, verified end-to-end)**
- `sessions` / `participants` / `session_events` are host-only; the
  public anon key can no longer enumerate PINs, tokens, names, emails,
  or event logs. Participants use SECURITY DEFINER RPCs with their
  participant UUID as bearer credential.
- Participants sign in anonymously; `auth_uid` on their row drives
  realtime and storage access.
- All broadcast channels private (RLS on `realtime.messages`): hosts
  send/receive; approved participants receive, and may send ONLY on
  `annotate:<session id>` (witness markup strokes).
- Storage owner-scoped per case folder; reads extended to approved
  participants of an active session (this made witness document viewing
  work for the first time). Delete policy added; duplicate policies
  dropped.
- Sessions linked to cases (`ensureRemoteCaseId`); participant views
  show the real case caption.
- Keep-alive workflow pings Supabase Mon/Thu so free tier doesn't pause.

**Features**
- **Admission gating** on all three participant views (witness /
  opposing counsel / court reporter), with waiting and declined screens.
- **Live-session UX**: header chip shows which deposition is live
  ("● Live: <witness> · PIN"), click to jump; session panel shows depo
  + case and real participant counts.
- **Audit trail**: complete event logging (session start/end, shares,
  marks, clears, admissions/removals, role changes, page directs,
  witness markup), 🕓 History view per session with participant roster
  and chronology, court-ready PDF export via print dialog.
- **Exhibit stamping**: marking a PDF burns the court-reporter-style
  yellow "EXHIBIT <n>" sticker (no date — exhibits are case-wide and
  reused across depos); stamped copy becomes canonical, original kept.
- **Witness annotation**: counsel starts markup; witness draws in red
  on the directed page; strokes stream live to counsel; saving flattens
  them into a new exhibit "<name> — as marked by witness".

## Verified working (live two-browser tests)

PIN join → anonymous auth → admission → private-channel exhibit push →
stamped PDF renders for witness → page direction sync → witness markup
round-trip → flattened exhibit created → audit events recorded → PDF
export → session end broadcast.

## Known gaps / backlog

**Security-ish (minor)**
- PIN brute-force hardening (6 digits, anon-callable lookup)
- Periodic purge of anonymous auth users (query in schema file)
- Participant sweep etiquette: delete test rows by name only — rosters
  of real ended sessions are part of the audit record

**Code cleanups**
- `/reset-password` route missing (forgot-password emails dead-end)
- Reuse one subscribed channel per session; revoke blob object URLs
- Stamp + markup assume unrotated pages (v1)
- Pre-existing lint: conditional useCallback in depo-exhibit-app.jsx

**AgileLaw feature roadmap (in recommended order)**
1. ~~Exhibit stamping~~ ✅
2. ~~Witness annotation~~ ✅
3. ~~Post-deposition exhibit package — zip of stamped exhibits + audit
   PDF + cover index~~ ✅ (migration pending production application)
4. ~~Opposing counsel presentation while holding control~~ ✅ (same
   case-wide number series; host marks OC exhibits into the record)
5. Numbering schemes (Plaintiff's/Defendant's prefixes, pre-marking)
6. Second chair / co-counsel (case_members table exists, no UI)
7. Email invites, witness-screen callouts, per-role exhibit downloads
