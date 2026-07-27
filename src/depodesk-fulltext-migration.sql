-- ============================================================
-- DepoDesk — exhibit full-text search (2026-07-23)
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Stores text extracted from uploaded exhibit PDFs so counsel can
-- search document CONTENTS across a whole case, not just names/tags.
--
-- Text is extracted in the browser with pdfjs at upload time (no server
-- compute, no third party) and upserted here. Rows are keyed by the
-- file's storage path, which is how the attorney app identifies a file
-- — the app's working data lives in localStorage, so this deliberately
-- does NOT depend on the (currently unused) public.exhibits table.
--
-- Scanned exhibits with no text layer index with has_text = false, so
-- the UI can tell counsel which documents were not searchable rather
-- than silently returning nothing.
-- ============================================================

create table if not exists public.exhibit_text (
  case_id       uuid not null references public.cases(id) on delete cascade,
  storage_path  text not null,
  exhibit_name  text,
  content       text not null default '',
  page_count    int  not null default 0,
  has_text      boolean not null default false,
  indexed_at    timestamptz not null default now(),
  primary key (case_id, storage_path)
);

-- Full-text index over the extracted content (English stemming).
create index if not exists exhibit_text_fts
  on public.exhibit_text
  using gin (to_tsvector('english', coalesce(content, '')));

-- Lookups by case (the search is always case-scoped).
create index if not exists exhibit_text_case on public.exhibit_text (case_id);

-- ── RLS: same ownership model as the rest of the case data ──────────
alter table public.exhibit_text enable row level security;

drop policy if exists "Case owners and members manage exhibit text" on public.exhibit_text;
create policy "Case owners and members manage exhibit text"
  on public.exhibit_text for all
  to authenticated
  using (
    exists (select 1 from public.cases c
             where c.id = case_id
               and (c.owner_id = auth.uid()
                    or exists (select 1 from public.case_members m
                                where m.case_id = c.id and m.user_id = auth.uid())))
  )
  with check (
    exists (select 1 from public.cases c
             where c.id = case_id
               and (c.owner_id = auth.uid()
                    or exists (select 1 from public.case_members m
                                where m.case_id = c.id and m.user_id = auth.uid())))
  );

-- Note: participants (witness / OC / reporter) get NO access here.
-- Extracted text is attorney work product; they only ever see the
-- exhibits counsel explicitly pushes to them.

-- ── Search: case-scoped full-text with ranked snippets ─────────────
-- Returns matches ordered by relevance with a highlighted excerpt.
-- websearch_to_tsquery gives users familiar syntax ("quoted phrases",
-- OR, -exclusions) and never errors on odd punctuation.
create or replace function public.search_exhibit_text(p_case_id uuid, p_query text)
returns table (
  storage_path text,
  exhibit_name text,
  page_count   int,
  snippet      text,
  rank         real
)
language sql stable security invoker set search_path = public
as $$
  select t.storage_path,
         t.exhibit_name,
         t.page_count,
         ts_headline('english', t.content,
                     websearch_to_tsquery('english', p_query),
                     'MaxFragments=2, MinWords=6, MaxWords=18, StartSel=«, StopSel=»'),
         ts_rank(to_tsvector('english', t.content),
                 websearch_to_tsquery('english', p_query))
    from public.exhibit_text t
   where t.case_id = p_case_id
     and t.has_text
     and to_tsvector('english', t.content) @@ websearch_to_tsquery('english', p_query)
   order by 5 desc
   limit 50
$$;

grant execute on function public.search_exhibit_text(uuid, text) to authenticated;

-- ── Verify ─────────────────────────────────────────────────────────
select 'exhibit_text table' as check,
       to_regclass('public.exhibit_text') is not null as pass
union all
select 'fts index',
       exists (select 1 from pg_indexes
                where schemaname = 'public' and indexname = 'exhibit_text_fts')
union all
select 'rls enabled',
       coalesce((select relrowsecurity from pg_class
                  where oid = 'public.exhibit_text'::regclass), false)
union all
select 'search function',
       exists (select 1 from pg_proc where proname = 'search_exhibit_text');
