-- ============================================================
-- DepoDesk — Opposing counsel presentation migration (2026-07-20)
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Lets the opposing-counsel participant who currently HOLDS CONTROL
-- present a document: upload it to the case's storage folder and
-- broadcast it on the session / pdf-sync channels. All other times
-- (and all other participants) remain blocked exactly as before.
-- Reading is unchanged — participants already read case files and
-- receive broadcasts via the existing policies.
-- ============================================================


-- ── 1. "This caller is the OC who holds control of this session" ──
-- SECURITY DEFINER: the realtime/storage policies that call this run
-- as the caller, who cannot read the host-only sessions table.
create or replace function public.can_present_as_oc(p_session_id uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1
      from public.sessions s
      join public.participants p on p.session_id = s.id
     where s.id = p_session_id
       and s.is_active
       and s.controller_role = 'opposing_counsel'
       and p.auth_uid = auth.uid()
       and p.role = 'opposing_counsel'
       and p.status = 'approved'
  )
$$;

grant execute on function public.can_present_as_oc(uuid) to anon, authenticated;


-- ── 2. Realtime send: allow the controlling OC on session/pdf-sync ──
-- Host branch and the annotate participant branch are unchanged; a new
-- branch lets the controlling OC send exhibit pushes and page syncs.
create or replace function public.can_send_session_broadcasts(p_topic text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
     where s.id::text = split_part(p_topic, ':', 2)
       and (s.host_id = auth.uid()
            or (split_part(p_topic, ':', 1) = 'annotate'
                and exists (select 1 from public.participants p
                             where p.session_id = s.id
                               and p.auth_uid = auth.uid()
                               and p.status = 'approved'))
            or (split_part(p_topic, ':', 1) in ('session', 'pdf-sync')
                and public.can_present_as_oc(s.id)))
  )
$$;


-- ── 3. Storage: the controlling OC may INSERT into the case folder ──
-- Insert-only (no update/delete), so OC can create new objects but
-- never overwrite the host's files. Path's first segment must be the
-- case UUID of an active session this caller controls as OC.
create or replace function public.can_write_oc_file(p_name text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1
      from public.sessions s
      join public.participants p on p.session_id = s.id
     where s.is_active
       and s.controller_role = 'opposing_counsel'
       and s.case_id::text = (storage.foldername(p_name))[1]
       and p.auth_uid = auth.uid()
       and p.role = 'opposing_counsel'
       and p.status = 'approved'
  )
$$;

grant execute on function public.can_write_oc_file(text) to anon, authenticated;

drop policy if exists "Opposing counsel in control can upload" on storage.objects;
create policy "Opposing counsel in control can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'exhibits' and public.can_write_oc_file(name));


-- ── 4. get_session_for_participant now also returns case_id ─────────
-- Return-type change requires DROP first. OC needs case_id to build
-- its upload path.
drop function if exists public.get_session_for_participant(uuid, uuid);
create or replace function public.get_session_for_participant(p_session_id uuid, p_participant_id uuid)
returns table (id uuid, pin text, is_active boolean, controller_role text, case_id uuid, case_name text, case_number text)
language sql security definer set search_path = public
as $$
  select s.id, s.pin, s.is_active, s.controller_role, s.case_id, c.name, c.number
    from public.sessions s
    left join public.cases c on c.id = s.case_id
   where s.id = p_session_id
     and exists (select 1 from public.participants p
                  where p.id = p_participant_id
                    and p.session_id = s.id
                    and p.status = 'approved')
$$;

grant execute on function public.get_session_for_participant(uuid, uuid) to anon, authenticated;


-- ── Verify ─────────────────────────────────────────────────────────
select 'storage insert policies' as check, string_agg(policyname, ', ') as detail
  from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
union all
select 'new functions', string_agg(proname, ', ')
  from pg_proc where proname in ('can_present_as_oc', 'can_write_oc_file')
union all
select 'get_session_for_participant returns case_id',
       case when exists (
         select 1 from pg_proc
          where proname = 'get_session_for_participant'
            and pg_get_function_result(oid) like '%case_id%'
       ) then 'yes' else 'NO' end;
