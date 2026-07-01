-- ============================================================
-- DepoDesk — Supabase Schema
-- Run this in your Supabase SQL Editor (supabase.com/dashboard)
-- ============================================================


-- ── 1. USERS (extends Supabase auth.users) ──────────────────
-- Supabase creates auth.users automatically when someone signs up.
-- We create a public profile table to store extra info.

create table public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  full_name   text,
  firm_name   text,
  email       text,
  created_at  timestamptz default now()
);

-- Auto-create a profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── 2. CASES ────────────────────────────────────────────────

create table public.cases (
  id          uuid default gen_random_uuid() primary key,
  owner_id    uuid references public.profiles(id) on delete cascade not null,
  name        text not null,                  -- "Smith v. Acme Corp."
  number      text,                           -- "2024-CV-00142"
  court       text,                           -- "S.D.N.Y."
  status      text default 'active'           -- active | pending | closed
                check (status in ('active', 'pending', 'closed')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Only the owner can see their cases (Row Level Security)
alter table public.cases enable row level security;

create policy "Users can manage their own cases"
  on public.cases
  for all
  using (auth.uid() = owner_id);


-- ── 3. CASE MEMBERS (sharing cases with co-counsel) ─────────
-- Lets you share a case with another attorney at your firm.

create table public.case_members (
  id         uuid default gen_random_uuid() primary key,
  case_id    uuid references public.cases(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  role       text default 'viewer'            -- viewer | editor | admin
               check (role in ('viewer', 'editor', 'admin')),
  invited_at timestamptz default now(),
  unique (case_id, user_id)
);

alter table public.case_members enable row level security;

create policy "Members can view cases they belong to"
  on public.case_members
  for select
  using (auth.uid() = user_id);

create policy "Case owners can manage members"
  on public.case_members
  for all
  using (
    exists (
      select 1 from public.cases
      where id = case_id and owner_id = auth.uid()
    )
  );


-- ── 4. EXHIBITS ──────────────────────────────────────────────

create table public.exhibits (
  id            uuid default gen_random_uuid() primary key,
  case_id       uuid references public.cases(id) on delete cascade not null,
  label         text not null,               -- "Exhibit 1"
  name          text not null,               -- "Employment Agreement"
  type          text default 'PDF'           -- PDF | Email | Image | Video
                  check (type in ('PDF', 'Email', 'Image', 'Video')),
  document_date date,                        -- date on the document itself
  tags          text[] default '{}',         -- ["contract", "HR"]
  file_path     text,                        -- Supabase Storage path
  file_name     text,                        -- original filename
  file_size     bigint,                      -- bytes
  marked        boolean default false,       -- marked into the record
  exhibit_order int default 0,              -- for manual reordering
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.exhibits enable row level security;

-- Exhibit access: case owner OR case member
create policy "Case members can view exhibits"
  on public.exhibits
  for select
  using (
    exists (
      select 1 from public.cases
      where id = case_id and owner_id = auth.uid()
    )
    or
    exists (
      select 1 from public.case_members
      where case_id = exhibits.case_id and user_id = auth.uid()
    )
  );

create policy "Case owners and editors can modify exhibits"
  on public.exhibits
  for all
  using (
    exists (
      select 1 from public.cases
      where id = case_id and owner_id = auth.uid()
    )
    or
    exists (
      select 1 from public.case_members
      where case_id = exhibits.case_id
        and user_id = auth.uid()
        and role in ('editor', 'admin')
    )
  );


-- ── 5. ANNOTATIONS ───────────────────────────────────────────
-- Private to the attorney who made them — never shared with witnesses.

create table public.annotations (
  id          uuid default gen_random_uuid() primary key,
  exhibit_id  uuid references public.exhibits(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  type        text not null                  -- stroke | note
                check (type in ('stroke', 'note')),
  data        jsonb not null,               -- { pts, color, tool } or { x, y, text, color }
  created_at  timestamptz default now()
);

alter table public.annotations enable row level security;

-- Annotations are strictly private — only the creator sees them
create policy "Users can only see their own annotations"
  on public.annotations
  for all
  using (auth.uid() = user_id);


-- ── 6. DEPOSITION SESSIONS ───────────────────────────────────
-- Tracks active deposition sessions for real-time sharing (Pusher).

create table public.sessions (
  id              uuid default gen_random_uuid() primary key,
  case_id         uuid references public.cases(id) on delete cascade not null,
  host_id         uuid references public.profiles(id) on delete cascade not null,
  active_exhibit  uuid references public.exhibits(id) on delete set null,
  witness_token   text unique default encode(gen_random_bytes(16), 'hex'),
                                            -- token in witness URL, no login needed
  started_at      timestamptz default now(),
  ended_at        timestamptz,
  is_active       boolean default true
);

alter table public.sessions enable row level security;

create policy "Session host can manage sessions"
  on public.sessions
  for all
  using (auth.uid() = host_id);

-- Witnesses use the token URL — no auth required for read
create policy "Anyone with token can read active session"
  on public.sessions
  for select
  using (is_active = true);


-- ── 7. STORAGE BUCKET ────────────────────────────────────────
-- Run this in Supabase Dashboard → Storage → New Bucket
-- Or uncomment and run via SQL:

-- insert into storage.buckets (id, name, public)
-- values ('exhibits', 'exhibits', false);

-- Storage policy: only authenticated users can upload
-- create policy "Authenticated users can upload exhibits"
--   on storage.objects for insert
--   with check (auth.role() = 'authenticated');

-- create policy "Case members can read exhibit files"
--   on storage.objects for select
--   using (auth.role() = 'authenticated');


-- ── 8. UPDATED_AT TRIGGERS ───────────────────────────────────

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_cases_updated_at
  before update on public.cases
  for each row execute procedure public.set_updated_at();

create trigger set_exhibits_updated_at
  before update on public.exhibits
  for each row execute procedure public.set_updated_at();


-- ── 9. PARTICIPANTS ──────────────────────────────────────────
-- Run this migration if the participants table already exists:
--
--   alter table public.participants
--   add column if not exists status text default 'pending'
--     check (status in ('pending', 'approved', 'rejected'));
--
-- Or create fresh:

create table if not exists public.participants (
  id           uuid default gen_random_uuid() primary key,
  session_id   uuid references public.sessions(id) on delete cascade not null,
  name         text not null,
  email        text,
  role         text not null check (role in ('witness', 'opposing_counsel', 'court_reporter')),
  status       text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  joined_at    timestamptz default now()
);

alter table public.participants enable row level security;

-- Anyone can insert (join request); host can read/update all
create policy "Anyone can request to join a session"
  on public.participants for insert
  with check (true);

create policy "Host can manage participants"
  on public.participants for all
  using (
    exists (
      select 1 from public.sessions
      where id = session_id and host_id = auth.uid()
    )
  );

create policy "Participants can read their own record"
  on public.participants for select
  using (true);


-- ── DONE ─────────────────────────────────────────────────────
-- Tables created:
--   profiles       → attorney accounts
--   cases          → matters / cases
--   case_members   → co-counsel sharing
--   exhibits       → documents in a case
--   annotations    → private attorney notes
--   sessions       → active deposition sessions
--   (storage)      → PDF/image file storage
