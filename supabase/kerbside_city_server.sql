-- Kerbside's city server: the one world, kept here, changed only by the server.
--
-- Paste into the Supabase dashboard's SQL editor once, after kerbside_city_grants.sql (safe to
-- run again). Then set the server's secret (the last statement of this file prints how).
--
-- The city (money, property, businesses, inventories, laws, damage, messages) is one versioned
-- record that only the city's server (api/city.mjs, server/city) reads and writes. A page never
-- touches these tables: they are closed to the public key, and every function below does
-- nothing unless it is given the server's secret, of which only the SHA-256 is kept here.
--
--   kerbside_city_world    the world: id, version, state (jsonb), when it last changed
--   kerbside_city_journal  every command that changed it, in order (who, what, when, with what)
--   kerbside_city_server   the server's secret, hashed
--
-- A commit is a compare-and-swap on the version, in one transaction with its journal line and
-- any backend grants it paid out: all of it happens or none of it does, and two server instances
-- can never both write "the next" state -- which is what keeps one history through restarts,
-- reconnects and failover.

create table if not exists kerbside_city_server (
  id int primary key default 1 check (id = 1),
  secret_sha256 text not null,
  set_at timestamptz not null default now()
);
create table if not exists kerbside_city_world (
  id text primary key,
  version bigint not null check (version > 0),
  state jsonb not null,
  updated timestamptz not null default now()
);
create table if not exists kerbside_city_journal (
  id bigserial primary key,
  world text not null,
  version bigint not null,
  pid text,
  command text,
  args jsonb,
  game_at double precision,
  at timestamptz not null default now()
);
create index if not exists kerbside_city_journal_world on kerbside_city_journal (world, version);
create index if not exists kerbside_city_journal_pid on kerbside_city_journal (pid, id);

alter table kerbside_city_server enable row level security;
alter table kerbside_city_world enable row level security;
alter table kerbside_city_journal enable row level security;
revoke all on kerbside_city_server, kerbside_city_world, kerbside_city_journal from anon, authenticated;

-- Whether ``secret`` is the server's.
create or replace function kerbside_city_is_server(secret text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select secret is not null and exists (
    select 1 from kerbside_city_server s where s.secret_sha256 = encode(digest(secret, 'sha256'), 'hex'));
$$;
revoke all on function kerbside_city_is_server(text) from public, anon, authenticated;

create or replace function kerbside_city_version(secret text, world text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not kerbside_city_is_server(secret) then return jsonb_build_object('refused', true); end if;
  return jsonb_build_object('version', coalesce((select w.version from kerbside_city_world w where w.id = world), 0));
end $$;

create or replace function kerbside_city_load(secret text, world text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare w kerbside_city_world;
begin
  if not kerbside_city_is_server(secret) then return jsonb_build_object('refused', true); end if;
  select * into w from kerbside_city_world x where x.id = world;
  if w.id is null then return jsonb_build_object('version', 0); end if;
  return jsonb_build_object('version', w.version, 'state', w.state);
end $$;

-- The next state, if the world is still at version ``expect`` (0: there is no world yet). The
-- journal line and the grants paid in it are written in the same transaction; a grant already
-- claimed stops the whole commit.
create or replace function kerbside_city_commit(secret text, world text, expect bigint, state jsonb, entry jsonb default null, grants bigint[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare now_version bigint; claimed int;
begin
  if not kerbside_city_is_server(secret) then return jsonb_build_object('refused', true); end if;
  if state is null or jsonb_typeof(state) <> 'object' then return jsonb_build_object('ok', false, 'why', 'no state'); end if;
  if expect = 0 then
    insert into kerbside_city_world (id, version, state) values (world, 1, state) on conflict (id) do nothing;
    if not found then
      return jsonb_build_object('ok', false, 'version', (select w.version from kerbside_city_world w where w.id = world));
    end if;
    now_version := 1;
  else
    update kerbside_city_world w set version = w.version + 1, state = kerbside_city_commit.state, updated = now()
      where w.id = world and w.version = expect returning w.version into now_version;
    if now_version is null then
      return jsonb_build_object('ok', false, 'version', coalesce((select w.version from kerbside_city_world w where w.id = world), 0));
    end if;
  end if;
  if coalesce(array_length(grants, 1), 0) > 0 then
    update kerbside_city_grants g set claimed_at = now() where g.id = any(grants) and g.claimed_at is null;
    get diagnostics claimed = row_count;
    if claimed <> array_length(grants, 1) then
      raise exception 'a grant was claimed already' using errcode = 'P0001';
    end if;
  end if;
  if entry is not null then
    insert into kerbside_city_journal (world, version, pid, command, args, game_at)
      values (world, now_version, entry->>'pid', entry->>'command', entry->'args', (entry->>'at')::double precision);
  end if;
  return jsonb_build_object('ok', true, 'version', now_version);
exception when sqlstate 'P0001' then
  -- The whole commit is undone (the world's version with it).
  return jsonb_build_object('ok', false, 'why', 'a grant was claimed already',
    'version', coalesce((select w.version from kerbside_city_world w where w.id = world), 0));
end $$;

-- Backend money waiting for a device account (by its key's SHA-256): what the server will mint.
create or replace function kerbside_city_pending_grants(secret text, key_sha256 text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not kerbside_city_is_server(secret) then return jsonb_build_object('refused', true); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'amount', g.amount) order by g.id)
    from kerbside_city_grants g where g.key_sha256 = kerbside_city_pending_grants.key_sha256 and g.claimed_at is null), '[]'::jsonb);
end $$;

grant execute on function kerbside_city_version(text, text) to anon, authenticated;
grant execute on function kerbside_city_load(text, text) to anon, authenticated;
grant execute on function kerbside_city_commit(text, text, bigint, jsonb, jsonb, bigint[]) to anon, authenticated;
grant execute on function kerbside_city_pending_grants(text, text) to anon, authenticated;

-- A page may no longer take a grant for itself (it could mint it into a world of its own):
-- grants are paid by the server alone, into the one world.
do $$ begin
  revoke execute on function kerbside_city_grants(text) from public, anon, authenticated;
  revoke execute on function kerbside_claim_city_grant(text, bigint) from public, anon, authenticated;
exception when undefined_function then null;
end $$;

-- The server's secret: made here the first time, shown ONCE in the result of this statement, and
-- kept only as its hash. Copy the value into the Vercel project as the environment variable
-- KERBSIDE_CITY_SECRET (Settings -> Environment Variables -> Production), then redeploy.
-- Running this file again does not change it. To replace it:
--     delete from kerbside_city_server;   -- then run this file again and copy the new value
with s as materialized (select encode(gen_random_bytes(32), 'hex') as secret),
made as (
  insert into kerbside_city_server (id, secret_sha256)
  select 1, encode(digest(s.secret, 'sha256'), 'hex') from s
  where not exists (select 1 from kerbside_city_server)
  returning 1
)
select case when exists (select 1 from made) then (select secret from s)
  else 'already set (unchanged): see the note above to replace it' end as "KERBSIDE_CITY_SECRET";
