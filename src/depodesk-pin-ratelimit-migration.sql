-- ============================================================
-- DepoDesk — PIN brute-force rate limiting (2026-07-22)
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- join_session_by_pin is anon-callable and the PIN is only 6 digits
-- (900k space), so it can be enumerated to discover active-session
-- PINs. (Admission is still manual and the caption no longer leaks,
-- so a discovered PIN only yields a host-gated join request — but we
-- still cap the enumeration rate.)
--
-- Approach: log FAILED lookups per client IP and refuse an IP after
-- too many failures in a window. The PIN lookup runs before the
-- participant's anonymous sign-in, so there is no auth.uid() to key
-- on — we use the client IP from the PostgREST request headers, which
-- is also much harder to rotate than free anonymous identities.
-- Correct PINs never log a failure, so real participants are unaffected
-- unless they mistype ~20 times in 15 minutes.
-- ============================================================

-- ── Attempt log (hidden; only the SECURITY DEFINER RPC touches it) ──
create table if not exists public.pin_attempts (
  id         bigint generated always as identity primary key,
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists pin_attempts_ip_time on public.pin_attempts (ip, created_at);
create index if not exists pin_attempts_time    on public.pin_attempts (created_at);

-- RLS on with no policy → no direct anon/authenticated access; the
-- definer function (table owner) bypasses RLS to read/write it.
alter table public.pin_attempts enable row level security;

-- ── Rate-limited PIN lookup ─────────────────────────────────────────
-- Return signature unchanged ({ id, pin }); reimplemented in plpgsql.
drop function if exists public.join_session_by_pin(text);

create or replace function public.join_session_by_pin(p_pin text)
returns table (id uuid, pin text)
language plpgsql security definer set search_path = public
as $$
declare
  v_ip    text;
  v_fails int;
  -- tunables
  c_window   constant interval := interval '15 minutes';
  c_max_fail constant int      := 20;
begin
  -- client IP = first hop of x-forwarded-for (set by the platform proxy);
  -- fall back to a shared 'unknown' bucket so a stripped header is still limited
  v_ip := trim(split_part(
            coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
            ',', 1));
  if v_ip = '' then v_ip := 'unknown'; end if;

  -- opportunistic prune (table stays tiny; no cron needed)
  delete from public.pin_attempts where created_at < now() - interval '1 hour';

  -- per-IP lockout
  select count(*) into v_fails
    from public.pin_attempts
   where ip = v_ip and created_at > now() - c_window;
  if v_fails >= c_max_fail then
    raise exception 'Too many attempts. Please wait a few minutes and try again.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.sessions s where s.pin = p_pin and s.is_active) then
    return query
      select s.id, s.pin from public.sessions s where s.pin = p_pin and s.is_active;
  else
    insert into public.pin_attempts (ip) values (v_ip);
    -- return nothing → client shows the generic "invalid PIN" message
  end if;
end;
$$;

grant execute on function public.join_session_by_pin(text) to anon, authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
select 'pin_attempts table' as check,
       to_regclass('public.pin_attempts') is not null as pass
union all
select 'join_session_by_pin is plpgsql (rate-limited)',
       exists (select 1 from pg_proc where proname = 'join_session_by_pin'
                 and prolang = (select oid from pg_language where lanname = 'plpgsql'));
