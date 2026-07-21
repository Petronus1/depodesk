-- ============================================================
-- DepoDesk — Supabase Schema
-- ============================================================
-- AUTHORITATIVE export of the production database, introspected
-- from pg_catalog on 2026-07-18. Running this file in a fresh
-- Supabase project's SQL Editor rebuilds the full backend:
-- tables, constraints, triggers, RLS policies, and the
-- SECURITY DEFINER functions the app calls via supabase.rpc().
--
-- Security model:
--   * Attorneys (authenticated) own their cases; RLS scopes every
--     table to the owner/host (co-counsel via case_members).
--   * Deposition participants (witness / opposing counsel / court
--     reporter) are UNAUTHENTICATED. They never read tables
--     directly — sessions, participants, and session_events are
--     host-only. They call the SECURITY DEFINER functions below,
--     which treat the participant's unguessable UUID as a bearer
--     credential and require approved status for session data.
-- ============================================================


-- ── 1. PROFILES (extends Supabase auth.users) ────────────────

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  firm_name   text,
  email       text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;
-- No policies: profiles are written by the auth trigger below and
-- are not read by the app directly.

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 2. CASES ─────────────────────────────────────────────────

create table public.cases (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null,                  -- "Smith v. Acme Corp."
  number      text,                           -- "2024-CV-00142"
  court       text,                           -- "S.D.N.Y."
  status      text default 'active'
                check (status in ('active', 'pending', 'closed')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.cases enable row level security;

create policy "Users can manage their own cases"
  on public.cases for all
  using (auth.uid() = owner_id);


-- ── 3. CASE MEMBERS (sharing cases with co-counsel) ──────────

create table public.case_members (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text default 'viewer'
               check (role in ('viewer', 'editor', 'admin')),
  invited_at timestamptz default now(),
  unique (case_id, user_id)
);

alter table public.case_members enable row level security;

create policy "Members can view cases they belong to"
  on public.case_members for select
  using (auth.uid() = user_id);

create policy "Case owners can manage members"
  on public.case_members for all
  using (
    exists (select 1 from public.cases
             where cases.id = case_members.case_id
               and cases.owner_id = auth.uid())
  );


-- ── 4. EXHIBITS ──────────────────────────────────────────────

create table public.exhibits (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.cases(id) on delete cascade,
  label         text not null,               -- "Exhibit 1"
  name          text not null,               -- "Employment Agreement"
  type          text default 'PDF'
                  check (type in ('PDF', 'Email', 'Image', 'Video')),
  document_date date,
  tags          text[] default '{}',
  file_path     text,                        -- Supabase Storage path
  file_name     text,
  file_size     bigint,
  marked        boolean default false,       -- marked into the record
  exhibit_order int default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.exhibits enable row level security;

create policy "Case members can view exhibits"
  on public.exhibits for select
  using (
    exists (select 1 from public.cases
             where cases.id = exhibits.case_id
               and cases.owner_id = auth.uid())
    or exists (select 1 from public.case_members
                where case_members.case_id = exhibits.case_id
                  and case_members.user_id = auth.uid())
  );

create policy "Case owners and editors can modify exhibits"
  on public.exhibits for all
  using (
    exists (select 1 from public.cases
             where cases.id = exhibits.case_id
               and cases.owner_id = auth.uid())
    or exists (select 1 from public.case_members
                where case_members.case_id = exhibits.case_id
                  and case_members.user_id = auth.uid()
                  and case_members.role in ('editor', 'admin'))
  );


-- ── 5. ANNOTATIONS (private attorney notes) ──────────────────

create table public.annotations (
  id          uuid primary key default gen_random_uuid(),
  exhibit_id  uuid not null references public.exhibits(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in ('stroke', 'note')),
  data        jsonb not null,   -- { pts, color, tool } or { x, y, text, color }
  created_at  timestamptz default now()
);

alter table public.annotations enable row level security;

create policy "Users can only see their own annotations"
  on public.annotations for all
  using (auth.uid() = user_id);


-- ── 6. DEPOSITION SESSIONS ───────────────────────────────────

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid references public.cases(id) on delete cascade,
  host_id         uuid not null references public.profiles(id) on delete cascade,
  active_exhibit  uuid references public.exhibits(id) on delete set null,
  witness_token   text unique default encode(gen_random_bytes(16), 'hex'),
                    -- legacy pre-PIN join flow; unused by current app
  started_at      timestamptz default now(),
  ended_at        timestamptz,
  is_active       boolean default true,
  pin             text unique,               -- 6-digit join PIN
  controller_id   uuid references public.profiles(id) on delete set null,
  controller_role text default 'host'        -- host | opposing_counsel
);

alter table public.sessions enable row level security;

create policy "Host manages own sessions"
  on public.sessions for all
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);


-- ── 7. PARTICIPANTS ──────────────────────────────────────────

create table public.participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  name         text not null,
  email        text,
  role         text not null
                 check (role in ('witness', 'opposing_counsel', 'court_reporter')),
  joined_at    timestamptz default now(),
  is_active    boolean default true,
  status       text default 'pending'
                 check (status in ('pending', 'approved', 'rejected')),
  auth_uid     uuid   -- anonymous auth identity, set by request_to_join;
                      -- lets realtime and storage policies recognize the
                      -- participant (requires Anonymous sign-ins enabled)
);

alter table public.participants enable row level security;

-- Host-only. Unauthenticated participants join via request_to_join()
-- and poll via get_participant_state() — never direct table access.
create policy "Host manages participants"
  on public.participants for all
  using (exists (select 1 from public.sessions s
                  where s.id = participants.session_id
                    and s.host_id = auth.uid()))
  with check (exists (select 1 from public.sessions s
                       where s.id = participants.session_id
                         and s.host_id = auth.uid()));


-- ── 8. SESSION EVENTS (exhibit log) ──────────────────────────

create table public.session_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  event_type   text not null,  -- exhibit_shared | exhibit_marked | control_transferred | participant_joined
  exhibit_id   uuid references public.exhibits(id) on delete set null,
  exhibit_name text,
  exhibit_num  int,
  exhibit_file_path text,                    -- canonical file snapshot for package export
  exhibit_file_name text,
  exhibit_mime_type text,
  actor_name   text,
  actor_role   text,
  notes        text,
  created_at   timestamptz default now()
);

alter table public.session_events enable row level security;

create policy "Host manages session events"
  on public.session_events for all
  using (exists (select 1 from public.sessions s
                  where s.id = session_events.session_id
                    and s.host_id = auth.uid()))
  with check (exists (select 1 from public.sessions s
                       where s.id = session_events.session_id
                         and s.host_id = auth.uid()));


-- ── 9. UPDATED_AT TRIGGERS ───────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_cases_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

create trigger set_exhibits_updated_at
  before update on public.exhibits
  for each row execute function public.set_updated_at();


-- ── 10. SESSION PIN GENERATOR (host-side) ────────────────────

create or replace function public.generate_session_pin()
returns text
language plpgsql security definer
as $$
declare
  new_pin text;
  pin_exists boolean;
begin
  loop
    new_pin := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    select count(*) > 0 into pin_exists
      from public.sessions
      where sessions.pin = new_pin and is_active = true;
    exit when not pin_exists;
  end loop;
  return new_pin;
end;
$$;


-- ── 11. PARTICIPANT RPCs (unauthenticated access path) ───────
-- Participant ids are unguessable UUIDs handed out at join time;
-- these functions treat them as bearer credentials.

-- Join step 1: look up a session by PIN (includes case caption).
create or replace function public.join_session_by_pin(p_pin text)
returns table (id uuid, pin text, case_name text, case_number text)
language sql security definer set search_path = public
as $$
  select s.id, s.pin, c.name, c.number
    from public.sessions s
    left join public.cases c on c.id = s.case_id
   where s.pin = p_pin and s.is_active
$$;

-- Join step 2: request admission (insert bypasses RLS; validates
-- active session, legal role, non-empty name; always pending).
-- Records the caller's (anonymous) auth.uid() so realtime and storage
-- policies can recognize the participant later.
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

-- Approval polling: status/role of one participant by id.
create or replace function public.get_participant_state(p_participant_id uuid)
returns table (status text, role text)
language sql security definer set search_path = public
as $$
  select status, role from public.participants where id = p_participant_id
$$;

-- Session details for an APPROVED participant of that session.
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

grant execute on function public.join_session_by_pin(text)               to anon, authenticated;
grant execute on function public.request_to_join(uuid, text, text, text) to anon, authenticated;
grant execute on function public.get_participant_state(uuid)             to anon, authenticated;
grant execute on function public.get_session_for_participant(uuid, uuid) to anon, authenticated;
grant execute on function public.get_session_events(uuid, uuid)          to anon, authenticated;


-- ── 12. STORAGE (exhibits bucket) ────────────────────────────
-- Create the private bucket (Dashboard → Storage → New Bucket, or):
--
--   insert into storage.buckets (id, name, public)
--   values ('exhibits', 'exhibits', false);
--
-- Policies on storage.objects (authenticated attorneys only):

-- Files are stored at "<case_uuid>/<exhibit_id>.<ext>", so the first
-- path segment identifies the case. Each policy scopes access to
-- cases the attorney owns or is a member of. Compare the folder as
-- text (c.id::text) rather than casting the folder to uuid, so files
-- under non-uuid legacy folders simply don't match instead of erroring.
create or replace function public.can_access_case_files(p_name text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.cases c
     where c.id::text = (storage.foldername(p_name))[1]
       and (c.owner_id = auth.uid()
            or exists (select 1 from public.case_members m
                        where m.case_id = c.id and m.user_id = auth.uid()))
  )
$$;

grant execute on function public.can_access_case_files(text) to authenticated;

-- Reads additionally allow an approved participant of an ACTIVE
-- session on the file's case (anonymous auth identity, matched via
-- participants.auth_uid), so signed URLs work in participant views.
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

-- The opposing-counsel participant who currently holds control may
-- INSERT (only) into the case folder, so they can present their own
-- document. Insert-only means they cannot overwrite the host's files.
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

create policy "Attorneys can upload exhibits"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'exhibits' and public.can_access_case_files(name));

create policy "Opposing counsel in control can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'exhibits' and public.can_write_oc_file(name));

create policy "Attorneys and participants can read exhibits"
  on storage.objects for select to authenticated
  using (bucket_id = 'exhibits' and public.can_read_case_files(name));

create policy "Attorneys can update exhibits"
  on storage.objects for update to authenticated
  using (bucket_id = 'exhibits' and public.can_access_case_files(name));

create policy "Attorneys can delete exhibits"
  on storage.objects for delete to authenticated
  using (bucket_id = 'exhibits' and public.can_access_case_files(name));


-- ── 13. REALTIME AUTHORIZATION (private channels) ────────────
-- All broadcast channels (session:<id>, pdf-sync:<id>,
-- reporter:<id>) are private — the client joins them with
-- { config: { private: true } } and RLS on realtime.messages
-- decides access: hosts send and receive; approved participants
-- (anonymous auth, matched via participants.auth_uid) receive only.
-- Requires "Allow anonymous sign-ins" enabled in Auth settings.
--
-- The checks are SECURITY DEFINER because policy subqueries run as
-- the caller, and participants cannot read the host-only sessions
-- table directly.

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

-- True when the caller is the opposing-counsel participant who
-- currently holds control of an active session. Gates OC presenting.
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

-- Hosts may send on any of their session's topics. Approved
-- participants may send on annotate:<session id> (witness markup),
-- and the OC who holds control may also send on session:/pdf-sync:
-- (present an exhibit + drive page sync) — never reporter:.
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

grant execute on function public.can_receive_session_broadcasts(text) to authenticated;
grant execute on function public.can_send_session_broadcasts(text)    to authenticated;

create policy "Hosts and approved participants can receive broadcasts"
  on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast'
         and public.can_receive_session_broadcasts(realtime.topic()));

create policy "Hosts can send broadcasts"
  on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast'
              and public.can_send_session_broadcasts(realtime.topic()));


-- ── KNOWN GAPS (future passes) ───────────────────────────────
-- * PINs are 6 digits and join_session_by_pin is anon-callable;
--   brute force is rate-limited only by Supabase.
-- * Anonymous sign-ins accumulate one auth.users row per joining
--   browser. Purge periodically:
--     delete from auth.users
--      where is_anonymous and created_at < now() - interval '30 days';
-- ============================================================
