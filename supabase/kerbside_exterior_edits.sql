-- Kerbside exterior edits: the canonical fronts everyone's world draws, written by verified editors.
--
-- Paste into the Supabase dashboard's SQL editor once (safe to run again), then the editor lines
-- scripts/editor_accounts.py --make "Name" prints (they store only a key's SHA-256). The tables are
-- closed to the public key; the page reads and writes through the functions below. Anyone may read
-- the edits; only a verified editor's key may write one, and every write is kept in the history.

create extension if not exists pgcrypto;

create table if not exists kerbside_editors (
  key_sha256 text primary key,
  name text not null,
  verified boolean not null default true,
  created timestamptz not null default now()
);

create table if not exists kerbside_exterior_edits (
  osm_id text primary key,
  edit jsonb not null,
  editor text not null,
  updated timestamptz not null default now()
);

create table if not exists kerbside_exterior_edit_history (
  id bigserial primary key,
  osm_id text not null,
  edit jsonb,
  editor text not null,
  at timestamptz not null default now()
);

alter table kerbside_editors enable row level security;
alter table kerbside_exterior_edits enable row level security;
alter table kerbside_exterior_edit_history enable row level security;
revoke all on kerbside_editors, kerbside_exterior_edits, kerbside_exterior_edit_history from anon, authenticated;

create or replace function kerbside_editor_of(key text) returns kerbside_editors
language sql stable security definer set search_path = public, extensions as $$
  select * from kerbside_editors where key_sha256 = encode(digest(key, 'sha256'), 'hex') and verified;
$$;
revoke all on function kerbside_editor_of(text) from public, anon, authenticated;

create or replace function kerbside_editor_whoami(key text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare e kerbside_editors;
begin
  e := kerbside_editor_of(key);
  if e.key_sha256 is null then return jsonb_build_object('verified', false); end if;
  return jsonb_build_object('verified', true, 'name', e.name);
end $$;

-- An edit is the editor module's own record (docs/exterior-editor.mjs, kerbside.exterior_edit/1):
-- checked here for its shape and size, never trusted for who wrote it or when.
create or replace function kerbside_save_exterior_edit(key text, edit jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e kerbside_editors; id text; stamped jsonb;
begin
  e := kerbside_editor_of(key);
  if e.key_sha256 is null then return jsonb_build_object('saved', false, 'why', 'not a verified editor'); end if;
  if edit->>'schema' is distinct from 'kerbside.exterior_edit/1' then
    return jsonb_build_object('saved', false, 'why', 'not an exterior edit');
  end if;
  id := edit->>'osm_id';
  if id is null or id !~ '^[0-9]{1,15}$' then return jsonb_build_object('saved', false, 'why', 'no building'); end if;
  if jsonb_typeof(edit->'openings') is distinct from 'array' or jsonb_array_length(edit->'openings') > 200
     or length(edit::text) > 200000 then
    return jsonb_build_object('saved', false, 'why', 'too large or malformed');
  end if;
  stamped := edit || jsonb_build_object('updated', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                        'editor', e.name, 'verified', true);
  insert into kerbside_exterior_edits (osm_id, edit, editor, updated) values (id, stamped, e.name, now())
    on conflict (osm_id) do update set edit = excluded.edit, editor = excluded.editor, updated = excluded.updated;
  insert into kerbside_exterior_edit_history (osm_id, edit, editor) values (id, stamped, e.name);
  return jsonb_build_object('saved', true, 'updated', stamped->>'updated');
end $$;

create or replace function kerbside_remove_exterior_edit(key text, osm_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e kerbside_editors;
begin
  e := kerbside_editor_of(key);
  if e.key_sha256 is null then return jsonb_build_object('removed', false); end if;
  delete from kerbside_exterior_edits where kerbside_exterior_edits.osm_id = kerbside_remove_exterior_edit.osm_id;
  insert into kerbside_exterior_edit_history (osm_id, edit, editor) values (kerbside_remove_exterior_edit.osm_id, null, e.name);
  return jsonb_build_object('removed', true);
end $$;

create or replace function kerbside_exterior_edits() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(osm_id, edit), '{}'::jsonb) from kerbside_exterior_edits;
$$;

grant execute on function kerbside_editor_whoami(text) to anon, authenticated;
grant execute on function kerbside_save_exterior_edit(text, jsonb) to anon, authenticated;
grant execute on function kerbside_remove_exterior_edit(text, text) to anon, authenticated;
grant execute on function kerbside_exterior_edits() to anon, authenticated;
