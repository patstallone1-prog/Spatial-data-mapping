-- Kerbside log-in: a username and a password, so a player is the same account on every device.
--
-- Paste into the Supabase dashboard's SQL editor once, after kerbside_device_accounts.sql (safe to
-- run again). Nothing here changes the functions already there: a device keeps its own account
-- secret (docs/kerbside-account.mjs), and logging in LINKS that device's row in kerbside_editors to
-- the account (account_id). Whatever is keyed by a device then resolves to its account through
-- kerbside_account_of(key). An account the owner verifies verifies every device logged in to it,
-- and only while it is logged in:
--
--     update kerbside_accounts set verified = true where lower(username) = 'coralheron';
--
-- A forgotten password is reset by the owner (there is no email; scripts/editor_accounts.py
-- --reset-password USERNAME prints this line with a new password):
--
--     update kerbside_accounts set password_hash = extensions.crypt('a new password', extensions.gen_salt('bf', 10))
--     where lower(username) = 'coralheron';
--
-- The tables are closed to the public key. The page reaches them only through the functions below,
-- each of which checks the device secret. Passwords are kept only as bcrypt hashes, and wrong
-- passwords are limited to 10 per username every 15 minutes.

create extension if not exists pgcrypto;

create table if not exists kerbside_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  display_name text not null,
  password_hash text not null,
  verified boolean not null default false,
  created timestamptz not null default now(),
  last_login timestamptz
);
create unique index if not exists kerbside_accounts_username on kerbside_accounts (lower(username));

create table if not exists kerbside_login_attempts (
  id bigserial primary key,
  username text not null,
  at timestamptz not null default now()
);
create index if not exists kerbside_login_attempts_by on kerbside_login_attempts (lower(username), at);

alter table kerbside_editors add column if not exists account_id uuid references kerbside_accounts (id) on delete set null;
-- True when the row is verified only because its account is: logging out takes that back.
alter table kerbside_editors add column if not exists verified_by_account boolean not null default false;

alter table kerbside_accounts enable row level security;
alter table kerbside_login_attempts enable row level security;
revoke all on kerbside_accounts, kerbside_login_attempts from anon, authenticated;
revoke all on sequence kerbside_login_attempts_id_seq from anon, authenticated;

-- Link the device (by its secret's digest) to an account, registering the device if the store has
-- not heard of it. Not callable from the page.
create or replace function kerbside_link_device(digest_hex text, account uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a kerbside_accounts;
begin
  select * into a from kerbside_accounts where id = account;
  if a.id is null then return; end if;
  insert into kerbside_editors (key_sha256, name, verified, last_seen)
    values (digest_hex, a.display_name, false, now())
    on conflict (key_sha256) do nothing;
  update kerbside_editors e set
      account_id = a.id,
      name = a.display_name,
      last_seen = now(),
      -- A device's own verification stays; one borrowed from another account does not.
      verified = (e.verified and not e.verified_by_account) or a.verified,
      verified_by_account = a.verified and not (e.verified and not e.verified_by_account)
    where e.key_sha256 = digest_hex;
end $$;

create or replace function kerbside_login_state(digest_hex text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'signed_in', true, 'account', a.id, 'username', a.username,
                              'name', a.display_name, 'verified', e.verified)
    from kerbside_editors e join kerbside_accounts a on a.id = e.account_id
    where e.key_sha256 = digest_hex), jsonb_build_object('ok', true, 'signed_in', false));
$$;

create or replace function kerbside_sign_up(key text, username text, password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare clean text := btrim(coalesce(username, '')); made uuid;
begin
  if key is null or key !~ '^[A-Za-z0-9_-]{20,128}$' then
    return jsonb_build_object('ok', false, 'why', 'this device has no account secret');
  end if;
  if clean !~ '^[A-Za-z0-9_.-]{3,24}$' then
    return jsonb_build_object('ok', false, 'why', 'a username is 3 to 24 letters, digits, dots, dashes or underscores');
  end if;
  if password is null or length(password) < 8 or length(password) > 128 then
    return jsonb_build_object('ok', false, 'why', 'a password is 8 to 128 characters');
  end if;
  if (select count(*) from kerbside_accounts where created > now() - interval '1 hour') >= 500 then
    return jsonb_build_object('ok', false, 'why', 'too many new accounts just now; try again later');
  end if;
  begin
    insert into kerbside_accounts (username, display_name, password_hash, last_login)
      values (clean, clean, crypt(password, gen_salt('bf', 10)), now())
      returning id into made;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'why', 'that username is taken');
  end;
  perform kerbside_link_device(encode(digest(key, 'sha256'), 'hex'), made);
  return kerbside_login_state(encode(digest(key, 'sha256'), 'hex'));
end $$;

create or replace function kerbside_sign_in(key text, username text, password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare clean text := btrim(coalesce(username, '')); a kerbside_accounts; good boolean;
begin
  if key is null or key !~ '^[A-Za-z0-9_-]{20,128}$' then
    return jsonb_build_object('ok', false, 'why', 'this device has no account secret');
  end if;
  if (select count(*) from kerbside_login_attempts t
      where lower(t.username) = lower(clean) and t.at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'why', 'too many wrong passwords; wait 15 minutes');
  end if;
  select * into a from kerbside_accounts where lower(kerbside_accounts.username) = lower(clean);
  -- The same bcrypt work whether or not the username exists, so the time does not tell.
  good := a.id is not null and crypt(coalesce(password, ''), a.password_hash) = a.password_hash;
  if a.id is null then perform crypt(coalesce(password, ''), gen_salt('bf', 10)); end if;
  if not good then
    insert into kerbside_login_attempts (username) values (left(clean, 64));
    delete from kerbside_login_attempts where at < now() - interval '1 day';
    return jsonb_build_object('ok', false, 'why', 'wrong username or password');
  end if;
  delete from kerbside_login_attempts t where lower(t.username) = lower(clean);
  update kerbside_accounts set last_login = now() where id = a.id;
  perform kerbside_link_device(encode(digest(key, 'sha256'), 'hex'), a.id);
  return kerbside_login_state(encode(digest(key, 'sha256'), 'hex'));
end $$;

create or replace function kerbside_sign_out(key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  update kerbside_editors set account_id = null,
      verified = verified and not verified_by_account,
      verified_by_account = false
    where key_sha256 = encode(digest(coalesce(key, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true, 'signed_in', false);
end $$;

create or replace function kerbside_login_whoami(key text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select kerbside_login_state(encode(digest(coalesce(key, ''), 'sha256'), 'hex'));
$$;

-- The account a device is logged in to, or null: what server-side state can be keyed by.
create or replace function kerbside_account_of(key text) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select account_id from kerbside_editors where key_sha256 = encode(digest(coalesce(key, ''), 'sha256'), 'hex');
$$;

-- A logged-in player's new name: the account's, and every device logged in to it.
create or replace function kerbside_account_rename(key text, name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare account uuid := kerbside_account_of(key); clean text;
begin
  if account is null then return jsonb_build_object('ok', false, 'why', 'not logged in'); end if;
  clean := btrim(left(regexp_replace(coalesce(name, ''), '[[:cntrl:]<>]', '', 'g'), 24));
  if clean = '' then return jsonb_build_object('ok', false, 'why', 'a name cannot be empty'); end if;
  update kerbside_accounts set display_name = clean where id = account;
  update kerbside_editors set name = clean where account_id = account;
  return kerbside_login_state(encode(digest(key, 'sha256'), 'hex'));
end $$;

-- The owner verifies (or un-verifies) an account: its logged-in devices follow at once.
create or replace function kerbside_account_verified_changed() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.verified then
    update kerbside_editors set verified = true, verified_by_account = true
      where account_id = new.id and not verified;
  else
    update kerbside_editors set verified = false, verified_by_account = false
      where account_id = new.id and verified_by_account;
  end if;
  return new;
end $$;
drop trigger if exists kerbside_account_verified on kerbside_accounts;
create trigger kerbside_account_verified after update of verified on kerbside_accounts
  for each row when (old.verified is distinct from new.verified)
  execute function kerbside_account_verified_changed();

revoke all on function kerbside_link_device(text, uuid) from public, anon, authenticated;
revoke all on function kerbside_login_state(text) from public, anon, authenticated;
revoke all on function kerbside_account_verified_changed() from public, anon, authenticated;
grant execute on function kerbside_sign_up(text, text, text) to anon, authenticated;
grant execute on function kerbside_sign_in(text, text, text) to anon, authenticated;
grant execute on function kerbside_sign_out(text) to anon, authenticated;
grant execute on function kerbside_login_whoami(text) to anon, authenticated;
grant execute on function kerbside_account_of(text) to anon, authenticated;
grant execute on function kerbside_account_rename(text, text) to anon, authenticated;
