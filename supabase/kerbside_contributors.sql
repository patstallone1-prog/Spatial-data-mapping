-- Kerbside contributors: photographs handed to family machines, results collected by the coordinator.
--
-- Paste into the Supabase dashboard's SQL editor once (it is safe to run again). Then run the
-- token lines scripts/contributor_coordinator.py --setup-sql prints, which store only the tokens'
-- SHA-256 hashes. The tables are closed to the public key; everything goes through the functions
-- below, each of which checks a token: contributors claim work and submit results, the
-- coordinator (this Mac) queues work, pulls results and tidies up.

create extension if not exists pgcrypto;

create table if not exists kerbside_settings (key text primary key, value text not null);

create table if not exists kerbside_contributors (
  device_id uuid primary key,
  name text,
  version text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  photos_done integer not null default 0,
  paused_reason text
);

create table if not exists kerbside_work (
  id bigserial primary key,
  work_key text unique not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed')),
  claimed_by uuid,
  claimed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists kerbside_work_by_status on kerbside_work (status, id);

create table if not exists kerbside_results (
  id bigserial primary key,
  work_id bigint,
  work_key text,
  device_id uuid,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table kerbside_settings enable row level security;
alter table kerbside_contributors enable row level security;
alter table kerbside_work enable row level security;
alter table kerbside_results enable row level security;
revoke all on kerbside_settings, kerbside_contributors, kerbside_work, kerbside_results from anon, authenticated;

create or replace function kerbside_token_ok(kind text, token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from kerbside_settings
                 where key = kind || '_token_sha256' and value = encode(digest(token, 'sha256'), 'hex'));
$$;
revoke all on function kerbside_token_ok(text, text) from public, anon, authenticated;

-- ---- contributors -------------------------------------------------------------------------------

create or replace function kerbside_heartbeat(token text, device uuid, device_name text,
                                              client_version text, paused text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not kerbside_token_ok('contributor', token) then raise exception 'not a contributor'; end if;
  insert into kerbside_contributors (device_id, name, version, paused_reason)
  values (device, device_name, client_version, paused)
  on conflict (device_id) do update set last_seen = now(), name = excluded.name,
    version = excluded.version, paused_reason = excluded.paused_reason;
  return json_build_object('queued', (select count(*) from kerbside_work where status = 'queued'));
end $$;

create or replace function kerbside_claim(token text, device uuid, how_many integer default 16)
returns setof kerbside_work language plpgsql security definer set search_path = public as $$
begin
  if not kerbside_token_ok('contributor', token) then raise exception 'not a contributor'; end if;
  return query
  update kerbside_work w
     set status = 'claimed', claimed_by = device, claimed_at = now(), attempts = w.attempts + 1
   where w.id in (select id from kerbside_work
                   where (status = 'queued' or (status = 'claimed' and claimed_at < now() - interval '6 hours'))
                     and attempts < 3
                   order by id limit least(greatest(how_many, 1), 64)
                   for update skip locked)
  returning w.*;
end $$;

create or replace function kerbside_submit(token text, device uuid, work bigint, result jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not kerbside_token_ok('contributor', token) then raise exception 'not a contributor'; end if;
  if octet_length(result::text) > 4000000 then raise exception 'result too large'; end if;
  update kerbside_work
     set status = case when result->>'outcome' = 'error' then 'failed' else 'done' end
   where id = work and claimed_by = device and status = 'claimed';
  if not found then raise exception 'not this device''s work'; end if;
  insert into kerbside_results (work_id, work_key, device_id, payload)
  select id, work_key, device, result from kerbside_work where id = work;
  update kerbside_contributors set photos_done = photos_done + 1, last_seen = now() where device_id = device;
end $$;

-- ---- the coordinator ----------------------------------------------------------------------------

create or replace function kerbside_enqueue(token text, items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare added integer;
begin
  if not kerbside_token_ok('coordinator', token) then raise exception 'not the coordinator'; end if;
  insert into kerbside_work (work_key, payload)
  select item->>'work_key', item->'payload' from jsonb_array_elements(items) item
  on conflict (work_key) do nothing;
  get diagnostics added = row_count;
  return added;
end $$;

create or replace function kerbside_pull(token text, after_id bigint, how_many integer default 200)
returns setof kerbside_results language plpgsql security definer set search_path = public as $$
begin
  if not kerbside_token_ok('coordinator', token) then raise exception 'not the coordinator'; end if;
  return query select * from kerbside_results where id > after_id order by id limit least(how_many, 500);
end $$;

create or replace function kerbside_ack(token text, upto_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not kerbside_token_ok('coordinator', token) then raise exception 'not the coordinator'; end if;
  delete from kerbside_results where id <= upto_id;
  delete from kerbside_work where status in ('done', 'failed') and claimed_at < now() - interval '1 day';
end $$;

create or replace function kerbside_withdraw(token text) returns setof text
language plpgsql security definer set search_path = public as $$
begin
  if not kerbside_token_ok('coordinator', token) then raise exception 'not the coordinator'; end if;
  return query delete from kerbside_work where status = 'queued'
               or (status = 'claimed' and claimed_at < now() - interval '1 day') returning work_key;
end $$;

create or replace function kerbside_status(token text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not kerbside_token_ok('coordinator', token) then raise exception 'not the coordinator'; end if;
  return json_build_object(
    'work', (select coalesce(json_object_agg(status, n), '{}'::json)
             from (select status, count(*) n from kerbside_work group by status) s),
    'results_waiting', (select count(*) from kerbside_results),
    'contributors', (select coalesce(json_agg(json_build_object('name', name, 'last_seen', last_seen,
                       'photos_done', photos_done, 'paused', paused_reason) order by last_seen desc), '[]'::json)
                     from kerbside_contributors));
end $$;

grant execute on function kerbside_heartbeat(text, uuid, text, text, text), kerbside_claim(text, uuid, integer),
  kerbside_submit(text, uuid, bigint, jsonb), kerbside_enqueue(text, jsonb), kerbside_pull(text, bigint, integer),
  kerbside_ack(text, bigint), kerbside_withdraw(text), kerbside_status(text) to anon, authenticated;
