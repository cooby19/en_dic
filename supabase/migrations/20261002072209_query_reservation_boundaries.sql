-- Evaluate identity and one clock sample AFTER the global reservation lock.
-- A caller can wait across a minute/UTC day boundary, or lose its invitation
-- while waiting. Charging a pre-lock bucket could bypass the new bucket's cap.
create or replace function private.reserve_query(p_request uuid) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid; reserved_at timestamptz; today date; bucket timestamptz;
begin
  perform pg_advisory_xact_lock(710241);
  uid := private.scope();
  if uid is null then return 'unauthorized'; end if;
  reserved_at := clock_timestamp();
  today := (reserved_at at time zone 'UTC')::date;
  bucket := date_trunc('minute', reserved_at at time zone 'UTC') at time zone 'UTC';
  delete from private.leases where expires_at<=reserved_at;
  if exists(select 1 from private.leases where user_id=uid) then return 'busy'; end if;
  if (select count(*) from private.leases)>=5 then return 'busy'; end if;
  if coalesce((select count from private.usage where user_id=uid and day=today),0)>=100 then return 'daily'; end if;
  if coalesce((select count from private.minute_usage where user_id=uid and minute=bucket),0)>=10 then return 'minute'; end if;
  insert into private.usage values(uid,today,1) on conflict(user_id,day) do update set count=private.usage.count+1;
  insert into private.minute_usage values(uid,bucket,1) on conflict(user_id,minute) do update set count=private.minute_usage.count+1;
  insert into private.leases values(uid,p_request,reserved_at+interval '60 seconds');
  return 'ok';
end $$;
