-- ============================================================
-- DepoDesk — RLS tightening migration (2026-07-18)
-- Run this in the Supabase SQL Editor (supabase.com/dashboard).
-- Safe to run more than once.
--
-- What this fixes: with the public anon key, anyone could
--   * list all active sessions, including PINs and witness tokens
--   * read every participant row (names, emails) across all sessions
--   * read the full session_events log of every session
--
-- After this migration, unauthenticated participants go through
-- SECURITY DEFINER functions that check their participant record
-- instead of open table reads. The app calls these via supabase.rpc().
-- ============================================================


-- ── 0. Housekeeping: end orphaned pre-PIN sessions ───────────
update public.sessions
   set is_active = false, ended_at = now()
 where is_active and pin is null;


-- ── 1. SESSIONS: host-only table access ──────────────────────
alter table public.sessions enable row level security;

-- Drop every existing policy on sessions, whatever its name
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'sessions'
  loop
    execute format('drop policy %I on public.sessions', p.policyname);
  end loop;
end $$;

create policy "Host manages own sessions"
  on public.sessions for all
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);


-- ── 2. PARTICIPANTS: host manages; public may only request ───
alter table public.participants enable row level security;

-- Drop every existing policy on participants, whatever its name
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'participants'
  loop
    execute format('drop policy %I on public.participants', p.policyname);
  end loop;
end $$;

create policy "Host manages participants"
  on public.participants for all
  using (exists (select 1 from public.sessions s
                 where s.id = session_id and s.host_id = auth.uid()))
  with check (exists (select 1 from public.sessions s
                      where s.id = session_id and s.host_id = auth.uid()));

-- Join requests go through a SECURITY DEFINER function instead of an
-- insert policy: the app needs the new row's id back, and INSERT …
-- RETURNING would require a select policy anon must not have.
create or replace function public.request_to_join(
  p_session_id uuid, p_name text, p_email text, p_role text
)
returns table (id uuid, status text)
language sql security definer set search_path = public
as $$
  insert into public.participants (session_id, name, email, role, status)
  select p_session_id,
         trim(p_name),
         nullif(trim(coalesce(p_email, '')), ''),
         p_role,
         'pending'
   where exists (select 1 from public.sessions s
                  where s.id = p_session_id and s.is_active)
     and p_role in ('witness', 'opposing_counsel', 'court_reporter')
     and length(trim(coalesce(p_name, ''))) > 0
  returning participants.id, participants.status
$$;

grant execute on function public.request_to_join(uuid, text, text, text) to anon, authenticated;

-- Clean up the earlier approach if present
drop policy   if exists "Anyone can request to join an active session" on public.participants;
drop function if exists public.session_is_active(uuid);


-- ── 3. SESSION EVENTS: host-only table access ────────────────
alter table public.session_events enable row level security;

-- Drop every existing policy on session_events, whatever its name
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'session_events'
  loop
    execute format('drop policy %I on public.session_events', p.policyname);
  end loop;
end $$;

create policy "Host manages session events"
  on public.session_events for all
  using (exists (select 1 from public.sessions s
                 where s.id = session_id and s.host_id = auth.uid()))
  with check (exists (select 1 from public.sessions s
                      where s.id = session_id and s.host_id = auth.uid()));


-- ── 4. RPCs for unauthenticated participants ─────────────────
-- Participant ids are unguessable UUIDs handed out at join time;
-- these functions treat them as bearer credentials.

-- Join step 1: look up a session by PIN. Returns only what the
-- join screen needs (and the case caption, which plain RLS could
-- never expose to anon).
create or replace function public.join_session_by_pin(p_pin text)
returns table (id uuid, pin text, case_name text, case_number text)
language sql security definer set search_path = public
as $$
  select s.id, s.pin, c.name, c.number
    from public.sessions s
    left join public.cases c on c.id = s.case_id
   where s.pin = p_pin and s.is_active
$$;

-- Approval polling: status/role of one participant by id.
create or replace function public.get_participant_state(p_participant_id uuid)
returns table (status text, role text)
language sql security definer set search_path = public
as $$
  select status, role from public.participants where id = p_participant_id
$$;

-- Session details for an APPROVED participant of that session.
create or replace function public.get_session_for_participant(p_session_id uuid, p_participant_id uuid)
returns table (id uuid, pin text, is_active boolean, controller_role text, case_name text, case_number text)
language sql security definer set search_path = public
as $$
  select s.id, s.pin, s.is_active, s.controller_role, c.name, c.number
    from public.sessions s
    left join public.cases c on c.id = s.case_id
   where s.id = p_session_id
     and exists (select 1 from public.participants p
                  where p.id = p_participant_id
                    and p.session_id = s.id
                    and p.status = 'approved')
$$;

-- Event log for an APPROVED participant of that session.
create or replace function public.get_session_events(p_session_id uuid, p_participant_id uuid)
returns setof public.session_events
language sql security definer set search_path = public
as $$
  select e.*
    from public.session_events e
   where e.session_id = p_session_id
     and exists (select 1 from public.participants p
                  where p.id = p_participant_id
                    and p.session_id = e.session_id
                    and p.status = 'approved')
$$;

grant execute on function public.join_session_by_pin(text)                       to anon, authenticated;
grant execute on function public.get_participant_state(uuid)                     to anon, authenticated;
grant execute on function public.get_session_for_participant(uuid, uuid)         to anon, authenticated;
grant execute on function public.get_session_events(uuid, uuid)                  to anon, authenticated;


-- ── Known limitations (future passes) ────────────────────────
-- * PINs are 6 digits and join_session_by_pin is callable by anon;
--   brute force is rate-limited only by Supabase. Fine for now.
-- * Realtime broadcast channels (session:<id>, pdf-sync:<id>,
--   reporter:<id>) are still open to anyone with the anon key who
--   learns a session id. Locking them down means Realtime private
--   channels + RLS on realtime.messages — separate migration.
-- * Storage policies for the exhibits bucket are not touched here.
-- * getSessionByToken/witness_token flow is legacy and no longer
--   works for anon after this migration (nothing uses it).
