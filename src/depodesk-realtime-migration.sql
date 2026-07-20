-- ============================================================
-- DepoDesk — Realtime channel privacy migration (2026-07-18)
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- PREREQUISITE (dashboard, one toggle):
--   Authentication → Sign In / Providers → enable "Anonymous
--   sign-ins". Participants sign in anonymously on the join page
--   so realtime RLS has an identity to authorize.
--
-- What this fixes:
--   * Broadcast channels (session:<id>, pdf-sync:<id>,
--     reporter:<id>) were public — anyone with the anon key who
--     learned a session id could listen in, or SEND fake exhibit
--     pushes to a witness's screen. Channels are now private:
--     hosts send and receive; approved participants receive only.
--   * Witnesses could never load exhibit files (signed URLs need
--     an authenticated role). Approved participants of an active
--     session can now read that case's files.
-- ============================================================


-- ── 1. Participants carry their anonymous auth identity ──────

alter table public.participants
  add column if not exists auth_uid uuid;

-- request_to_join now records the caller's auth.uid() so realtime
-- and storage policies can recognize the participant later.
create or replace function public.request_to_join(
  p_session_id uuid, p_name text, p_email text, p_role text
)
returns table (id uuid, status text)
language sql security definer set search_path = public
as $$
  insert into public.participants (session_id, name, email, role, status, auth_uid)
  select p_session_id,
         trim(p_name),
         nullif(trim(coalesce(p_email, '')), ''),
         p_role,
         'pending',
         auth.uid()
   where exists (select 1 from public.sessions s
                  where s.id = p_session_id and s.is_active)
     and p_role in ('witness', 'opposing_counsel', 'court_reporter')
     and length(trim(coalesce(p_name, ''))) > 0
  returning participants.id, participants.status
$$;


-- ── 2. Realtime: private-channel authorization ───────────────
-- Topics look like "session:<uuid>", "pdf-sync:<uuid>",
-- "reporter:<uuid>" — the uuid after the colon is the session id.

-- The checks are SECURITY DEFINER: policy subqueries run as the
-- caller, and participants cannot read the host-only sessions table
-- directly — a plain subquery would deny everyone but the host.
create or replace function public.can_receive_session_broadcasts(p_topic text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
     where s.id::text = split_part(p_topic, ':', 2)
       and (s.host_id = auth.uid()
            or exists (select 1 from public.participants p
                        where p.session_id = s.id
                          and p.auth_uid = auth.uid()
                          and p.status = 'approved'))
  )
$$;

-- Hosts may send on any of their session's topics. Approved
-- participants may send ONLY on annotate:<session id> — the witness
-- markup stroke channel — never on session:/pdf-sync:/reporter:
-- (which would allow spoofing exhibit pushes).
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
                               and p.status = 'approved')))
  )
$$;

grant execute on function public.can_receive_session_broadcasts(text) to authenticated;
grant execute on function public.can_send_session_broadcasts(text)    to authenticated;

drop policy if exists "Hosts and approved participants can receive broadcasts" on realtime.messages;
drop policy if exists "Hosts can send broadcasts"                              on realtime.messages;

create policy "Hosts and approved participants can receive broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_receive_session_broadcasts(realtime.topic())
  );

create policy "Hosts can send broadcasts"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_send_session_broadcasts(realtime.topic())
  );


-- ── 3. Storage: approved participants can READ case files ────
-- Write access (upload/update/delete) stays owner/member-only via
-- can_access_case_files. Reads additionally allow an approved
-- participant of an ACTIVE session on the file's case, so signed
-- URLs work in the witness / opposing counsel views.

create or replace function public.can_read_case_files(p_name text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.cases c
     where c.id::text = (storage.foldername(p_name))[1]
       and (c.owner_id = auth.uid()
            or exists (select 1 from public.case_members m
                        where m.case_id = c.id and m.user_id = auth.uid())
            or exists (select 1 from public.participants p
                        join public.sessions s on s.id = p.session_id
                       where p.auth_uid = auth.uid()
                         and p.status = 'approved'
                         and s.is_active
                         and s.case_id = c.id))
  )
$$;

grant execute on function public.can_read_case_files(text) to authenticated;

drop policy if exists "Attorneys can read exhibits" on storage.objects;

create policy "Attorneys and participants can read exhibits"
  on storage.objects for select to authenticated
  using (bucket_id = 'exhibits' and public.can_read_case_files(name));


-- ── Housekeeping note ────────────────────────────────────────
-- Anonymous sign-ins create one auth.users row per joining browser
-- (reused across joins from the same browser). To purge old ones:
--
--   delete from auth.users
--    where is_anonymous and created_at < now() - interval '30 days';
