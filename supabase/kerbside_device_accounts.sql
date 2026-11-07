-- Kerbside device accounts: no sign-in and no editor key to hand out.
--
-- Paste into the Supabase dashboard's SQL editor once, after kerbside_exterior_edits.sql (safe to
-- run again). Each device makes its own account secret (docs/kerbside-account.mjs) and registers
-- it here under its name; the row is NOT verified, so its saves stay on that device. To let an
-- account change the world for everyone, verify it on the backend:
--
--     update kerbside_editors set verified = true where name = 'Coral Heron 47';
--
-- (or tick `verified` on its row in the Table editor; scripts/editor_accounts.py --verify NAME
-- prints the line). Un-verify the same way: the store checks the secret on every save.

alter table kerbside_editors add column if not exists last_seen timestamptz;
alter table kerbside_editors alter column verified set default false;

-- Register (or rename) this device's account. Only ever creates an UNVERIFIED row; never changes
-- whether a row is verified. Refuses once there are a great many unverified rows (a flood).
create or replace function kerbside_register_device(key text, name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare digest_hex text; clean text; e kerbside_editors;
begin
  if key is null or key !~ '^[A-Za-z0-9_-]{20,128}$' then
    return jsonb_build_object('registered', false, 'why', 'not an account secret');
  end if;
  clean := left(regexp_replace(coalesce(name, ''), '[[:cntrl:]<>]', '', 'g'), 24);
  if btrim(clean) = '' then clean := 'Unnamed'; end if;
  digest_hex := encode(digest(key, 'sha256'), 'hex');
  select * into e from kerbside_editors where key_sha256 = digest_hex;
  if e.key_sha256 is null then
    if (select count(*) from kerbside_editors where not verified) >= 20000 then
      return jsonb_build_object('registered', false, 'why', 'too many accounts waiting');
    end if;
    insert into kerbside_editors (key_sha256, name, verified, last_seen) values (digest_hex, btrim(clean), false, now());
    return jsonb_build_object('registered', true, 'verified', false, 'name', btrim(clean));
  end if;
  update kerbside_editors set name = btrim(clean), last_seen = now() where key_sha256 = digest_hex;
  return jsonb_build_object('registered', true, 'verified', e.verified, 'name', btrim(clean));
end $$;

-- Whoami also says whether the store has heard of the account at all.
create or replace function kerbside_editor_whoami(key text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare e kerbside_editors;
begin
  select * into e from kerbside_editors where key_sha256 = encode(digest(key, 'sha256'), 'hex');
  if e.key_sha256 is null then return jsonb_build_object('verified', false, 'registered', false); end if;
  if not e.verified then return jsonb_build_object('verified', false, 'registered', true, 'name', e.name); end if;
  return jsonb_build_object('verified', true, 'registered', true, 'name', e.name);
end $$;

grant execute on function kerbside_register_device(text, text) to anon, authenticated;
grant execute on function kerbside_editor_whoami(text) to anon, authenticated;
