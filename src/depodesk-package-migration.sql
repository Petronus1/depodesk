-- Post-deposition package support: retain the canonical file snapshot
-- associated with each marked-exhibit audit event.
alter table public.session_events
  add column if not exists exhibit_file_path text,
  add column if not exists exhibit_file_name text,
  add column if not exists exhibit_mime_type text;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'session_events'
  and column_name in ('exhibit_file_path', 'exhibit_file_name', 'exhibit_mime_type')
order by column_name;
