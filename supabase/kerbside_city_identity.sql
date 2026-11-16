-- Resolve a signed-in device to its account for the authoritative city, and revoke stale sessions
-- after that device signs out or switches account. The device secret never leaves its browser
-- except when opening its session; this server-only function accepts its SHA-256.
create or replace function kerbside_city_device_account(secret text, key_sha256 text) returns uuid
language plpgsql stable security definer set search_path=public,extensions as $$
begin
 if not kerbside_city_is_server(secret) then raise exception 'not the city server'; end if;
 return (select account_id from kerbside_editors e where e.key_sha256=kerbside_city_device_account.key_sha256);
end $$;
revoke all on function kerbside_city_device_account(text,text) from public,anon,authenticated;
grant execute on function kerbside_city_device_account(text,text) to anon,authenticated;
