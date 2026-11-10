-- Paste into the Supabase SQL editor and Run, once. It sets up city grants (the same as
-- supabase/kerbside_city_grants.sql) and gives 1,000,000 credits to the device account seen most
-- recently -- the last check below says whose. Open City on that device and the money is in
-- your wallet ("1,000,000 credits from the backend" in the corner).

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

create or replace function kerbside_city_grants(key text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'amount', g.amount, 'note', g.note) order by g.id), '[]'::jsonb)
  from kerbside_city_grants g
  where g.key_sha256 = encode(digest(key, 'sha256'), 'hex') and g.claimed_at is null;
$$;

create or replace function kerbside_claim_city_grant(key text, grant_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  update kerbside_city_grants set claimed_at = now()
  where id = grant_id and key_sha256 = encode(digest(key, 'sha256'), 'hex') and claimed_at is null;
  return jsonb_build_object('claimed', found);
end $$;

grant execute on function kerbside_city_grants(text) to anon, authenticated;
grant execute on function kerbside_claim_city_grant(text, bigint) to anon, authenticated;

-- 1,000,000 credits (amounts are cents) to the most recently seen device.
insert into kerbside_city_grants (key_sha256, amount, note)
select key_sha256, 100000000, '1,000,000 credits for testing cars and garages'
from kerbside_editors
order by coalesce(last_seen, created) desc
limit 1;

-- Whose it went to (the newest grant), and the next most recent devices in case it was not yours.
select e.name, e.last_seen, g.amount / 100 as credits, g.created
from kerbside_city_grants g join kerbside_editors e using (key_sha256)
order by g.id desc limit 1;
select name, last_seen, created from kerbside_editors order by coalesce(last_seen, created) desc limit 3;
