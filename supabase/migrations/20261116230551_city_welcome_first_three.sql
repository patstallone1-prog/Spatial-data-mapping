-- The first three named accounts receive a single testing starter package.
-- Anonymous devices do not qualify. Deleted accounts never free a used slot.
create table if not exists public.kerbside_city_welcome_accounts (
  slot smallint primary key check (slot between 1 and 3),
  account_id uuid unique references public.kerbside_accounts(id) on delete set null,
  credit_cents bigint not null default 100000000 check (credit_cents = 100000000),
  restaurant_id text not null unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
alter table public.kerbside_city_welcome_accounts enable row level security;
revoke all on public.kerbside_city_welcome_accounts from public,anon,authenticated;

create or replace function public.kerbside_allocate_city_welcome() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare next_slot int;
begin
  -- Serialize concurrent sign-ups without locking any city/player data.
  perform pg_advisory_xact_lock(1668161639, 3);
  select coalesce(max(slot),0)+1 into next_slot from public.kerbside_city_welcome_accounts;
  if next_slot<=3 then
    insert into public.kerbside_city_welcome_accounts(slot,account_id,restaurant_id)
      values(next_slot,new.id,(array['263347484','263343082','272598431'])[next_slot]);
  end if;
  return new;
end $$;
revoke all on function public.kerbside_allocate_city_welcome() from public,anon,authenticated;
drop trigger if exists kerbside_first_three_city_accounts on public.kerbside_accounts;
create trigger kerbside_first_three_city_accounts after insert on public.kerbside_accounts
  for each row execute function public.kerbside_allocate_city_welcome();

-- If this is installed after sign-up, reserve remaining slots in original account order.
do $$
declare a record; next_slot int;
begin
 perform pg_advisory_xact_lock(1668161639,3);
 for a in select id from public.kerbside_accounts order by created,id loop
  select coalesce(max(slot),0)+1 into next_slot from public.kerbside_city_welcome_accounts;
  exit when next_slot>3;
  if not exists(select 1 from public.kerbside_city_welcome_accounts w where w.account_id=a.id) then
   insert into public.kerbside_city_welcome_accounts(slot,account_id,restaurant_id)
    values(next_slot,a.id,(array['263347484','263343082','272598431'])[next_slot]);
  end if;
 end loop;
end $$;

create or replace function public.kerbside_city_welcome(secret text, account uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not public.kerbside_city_is_server(secret) then return jsonb_build_object('refused',true); end if;
 return (select jsonb_build_object('account_id',w.account_id,'slot',w.slot,'credit_cents',w.credit_cents,'restaurant_id',w.restaurant_id)
   from public.kerbside_city_welcome_accounts w where w.account_id=account and w.claimed_at is null);
end $$;
revoke all on function public.kerbside_city_welcome(text,uuid) from public,anon,authenticated;
grant execute on function public.kerbside_city_welcome(text,uuid) to anon,authenticated;

-- Claim the starter atomically with the existing CAS world/ledger commit. A lost race,
-- malformed receipt or duplicate claim rolls back the whole package and its journal entry.
create or replace function public.kerbside_city_commit_with_welcome(
 secret text, world text, expect bigint, state jsonb, entry jsonb, grants bigint[], welcome_account uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; receipt jsonb; claimed int;
begin
 if not public.kerbside_city_is_server(secret) then return jsonb_build_object('refused',true); end if;
 receipt:=state->'server'->'welcomeReceipts'->welcome_account::text;
 if receipt is null or receipt->>'restaurant_id' is null then
  return jsonb_build_object('ok',false,'why','missing starter receipt');
 end if;
 result:=public.kerbside_city_commit(secret,world,expect,state,entry,grants);
 if not coalesce((result->>'ok')::boolean,false) then return result; end if;
 update public.kerbside_city_welcome_accounts w
  set claimed_at=now(),restaurant_id=receipt->>'restaurant_id'
  where w.account_id=welcome_account and w.claimed_at is null
   and w.slot=(receipt->>'slot')::int and w.credit_cents=(receipt->>'credit_cents')::bigint;
 get diagnostics claimed=row_count;
 if claimed<>1 then raise exception 'starter already claimed' using errcode='P0001'; end if;
 return result;
exception when sqlstate 'P0001' or unique_violation then
 return jsonb_build_object('ok',false,'why','starter already claimed or restaurant occupied');
end $$;
revoke all on function public.kerbside_city_commit_with_welcome(text,text,bigint,jsonb,jsonb,bigint[],uuid) from public,anon,authenticated;
grant execute on function public.kerbside_city_commit_with_welcome(text,text,bigint,jsonb,jsonb,bigint[],uuid) to anon,authenticated;
notify pgrst,'reload schema';
