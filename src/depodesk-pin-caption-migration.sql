-- ============================================================
-- DepoDesk — PIN lookup no longer leaks the case caption (2026-07-22)
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- SECURITY FIX. Previously join_session_by_pin (anon-callable)
-- returned the case NAME and NUMBER for any valid 6-digit PIN,
-- before the host admitted the caller. Because the case caption
-- contains the party names, a script enumerating the 900k PIN
-- space could harvest confidential client/matter captions of
-- active sessions without ever being admitted.
--
-- After this migration the PIN lookup returns only the session id
-- and pin — i.e. "this PIN is valid, here is the session to request
-- into". The caption is disclosed only after admission, via
-- get_session_for_participant, which already gates on
-- status = 'approved'. The role views (witness / opposing-counsel /
-- court-reporter) already read the caption from that gated RPC, so
-- approved participants are unaffected.
--
-- Requires the matching client change in depodesk-join.jsx (the
-- details step no longer displays the caption pre-admission).
-- ============================================================

-- Return signature changes (columns removed), so drop first.
drop function if exists public.join_session_by_pin(text);

-- Join step 1: validate a PIN. Returns ONLY the session id + pin;
-- the case caption is intentionally withheld until admission.
create or replace function public.join_session_by_pin(p_pin text)
returns table (id uuid, pin text)
language sql security definer set search_path = public
as $$
  select s.id, s.pin
    from public.sessions s
   where s.pin = p_pin and s.is_active
$$;

grant execute on function public.join_session_by_pin(text) to anon, authenticated;

-- ── Verification ─────────────────────────────────────────────
-- Confirms the function no longer exposes caption columns.
select 'join_session_by_pin hides caption' as check,
       not exists (
         select 1
           from pg_proc p
          where p.proname = 'join_session_by_pin'
            and pg_get_function_result(p.oid) ilike '%case_name%'
       ) as pass;
