-- Kerbside city grants: money put into a device account's city wallet from the backend.
--
-- Paste into the Supabase dashboard's SQL editor once, after kerbside_device_accounts.sql (safe
-- to run again). A grant is to one device account (kerbside_editors, by its key's SHA-256); the
-- device's City finds it on load (docs/kerbside-account.mjs cityGrants), puts it in your wallet
-- once (docs/city/world.mjs cmd_account_grant, by the grant's id) and marks it claimed. Grants are
-- closed to the public key like the rest: a device sees and claims only its own.
--
-- To give an account money (amounts are cents: 100000000 is 1,000,000 credits):
--
--     insert into kerbside_city_grants (key_sha256, amount, note)
--     select key_sha256, 100000000, 'for testing' from kerbside_editors where name = 'Coral Heron 47';

create table if not exists kerbside_city_grants (
  id bigserial primary key,
  key_sha256 text not null references kerbside_editors(key_sha256) on delete cascade,
  amount bigint not null check (amount > 0 and amount <= 500000000),
  note text,
  created timestamptz not null default now(),
  claimed_at timestamptz
);
alter table kerbside_city_grants enable row level security;
revoke all on kerbside_city_grants from anon, authenticated;

-- This device's grants not yet in its wallet.
create or replace function kerbside_city_grants(key text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'amount', g.amount, 'note', g.note) order by g.id), '[]'::jsonb)
  from kerbside_city_grants g
  where g.key_sha256 = encode(digest(key, 'sha256'), 'hex') and g.claimed_at is null;
$$;

-- In the wallet now: claimed, so no other world of this device's mints it again.
create or replace function kerbside_claim_city_grant(key text, grant_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  update kerbside_city_grants set claimed_at = now()
  where id = grant_id and key_sha256 = encode(digest(key, 'sha256'), 'hex') and claimed_at is null;
  return jsonb_build_object('claimed', found);
end $$;

grant execute on function kerbside_city_grants(text) to anon, authenticated;
grant execute on function kerbside_claim_city_grant(text, bigint) to anon, authenticated;
