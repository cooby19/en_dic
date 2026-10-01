-- Apply as an administrator. The web service uses a separate NOBYPASSRLS login.
create extension if not exists supabase_vault with schema vault;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='en_dic_runtime') then
    create role en_dic_runtime nologin nosuperuser nobypassrls;
  end if;
end $$;
grant usage on schema private to en_dic_runtime;
alter default privileges in schema private revoke execute on functions from public;

create table private.invites (email text primary key check(email=lower(email)), user_id uuid unique, active boolean not null default true);
create table private.sessions (hash text primary key, user_id uuid not null, expires_at timestamptz not null);
create index sessions_user on private.sessions(user_id);
create table private.login_flows (hash text primary key, verifier text not null, expires_at timestamptz not null);
create table private.connections (
  user_id uuid primary key, secret_id uuid, model text not null default 'gemini-3.8-flash',
  version integer not null default 0, tested_at timestamptz, status text not null default 'disconnected' check(status in ('connected','disconnected','error'))
);
create table private.entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, request_id uuid not null,
  original text not null check(char_length(original) between 1 and 3000), context text not null default '' check(char_length(context)<=1000),
  normalized text not null, normalized_context text not null, analysis jsonb not null,
  provider text not null default 'google' check(provider='google'), model text not null,
  source text not null default '' check(char_length(source)<=1000), notes text not null default '' check(char_length(notes)<=4000),
  favorite boolean not null default false, created_at timestamptz not null default clock_timestamp(), favorited_at timestamptz,
  expires_at timestamptz default (clock_timestamp()+interval '336 hours'),
  review text check(review in ('remembered','learning')), reviewed_at timestamptz, analysis_version integer not null default 1 check(analysis_version=1),
  unique(user_id,request_id), check ((favorite and expires_at is null and favorited_at is not null) or (not favorite and expires_at is not null))
);
create index entries_history on private.entries(user_id,created_at desc,id desc);
create index entries_favorites on private.entries(user_id,favorited_at desc,id desc) where favorite;
create index entries_duplicate on private.entries(user_id,normalized,normalized_context) where favorite;
create index entries_expiry on private.entries(expires_at) where not favorite;
create table private.usage (user_id uuid not null, day date not null, count integer not null, primary key(user_id,day));
create table private.leases (user_id uuid primary key, request_id uuid not null, expires_at timestamptz not null);
-- Successful request IDs stay as tombstones even when an entry is individually deleted or expires.
create table private.requests (user_id uuid not null, request_id uuid not null, fingerprint text not null, entry_id uuid not null, primary key(user_id,request_id));
create table private.minute_usage (user_id uuid not null, minute timestamptz not null, count integer not null, primary key(user_id,minute));

create function private.check_session(p_hash text) returns table(user_id uuid)
language sql security definer set search_path='' as $$
  select s.user_id from private.sessions s join private.invites i on i.user_id=s.user_id
  where s.hash=p_hash and s.expires_at>clock_timestamp() and i.active;
$$;
create function private.scope() returns uuid language sql security definer set search_path='' as $$
  select s.user_id from private.check_session(current_setting('app.session_hash',true)) s
  where s.user_id::text=current_setting('app.user_id',true);
$$;
create function private.begin_login(p_hash text,p_verifier text) returns void language sql security definer set search_path='' as $$
  insert into private.login_flows values(p_hash,p_verifier,clock_timestamp()+interval '10 minutes');
$$;
create function private.consume_login(p_hash text) returns table(verifier text) language sql security definer set search_path='' as $$
  delete from private.login_flows where hash=p_hash and expires_at>clock_timestamp() returning verifier;
$$;
create function private.create_session(p_id uuid,p_email text,p_hash text) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update private.invites set user_id=p_id where email=lower(p_email) and active and (user_id is null or user_id=p_id);
  if not found then return false; end if;
  insert into private.sessions values(p_hash,p_id,clock_timestamp()+interval '7 days');
  return true;
end $$;
create function private.logout(p_hash text) returns void language sql security definer set search_path='' as $$
  delete from private.sessions where hash=p_hash;
$$;

alter table private.entries enable row level security;
create policy owner_entries on private.entries to en_dic_runtime
  using(user_id=(select private.scope()) and (favorite or expires_at>clock_timestamp()))
  with check(user_id=(select private.scope()) and (favorite or expires_at>clock_timestamp()));
grant select,insert,update,delete on private.entries to en_dic_runtime;
-- Administrative tables have no runtime grants; every access goes through a bounded function.
do $$ declare t text; begin
  foreach t in array array['invites','sessions','login_flows','connections','usage','leases','requests','minute_usage'] loop
    execute format('alter table private.%I enable row level security',t);
  end loop;
end $$;

create function private.connection_status() returns table(connected boolean,model text,version integer,tested_at timestamptz,status text)
language sql security definer set search_path='' as $$
  select secret_id is not null,model,version,tested_at,status from private.connections where user_id=private.scope();
$$;
create function private.read_credential(p_version integer) returns text language plpgsql security definer set search_path='' as $$
declare v_secret uuid; value text; begin
  select secret_id into v_secret from private.connections where user_id=private.scope() and version=p_version and secret_id is not null;
  if v_secret is null then return null; end if;
  select decrypted_secret into value from vault.decrypted_secrets where id=v_secret;
  return value;
end $$;
create function private.save_connection(p_key text,p_model text,p_version integer) returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.scope(); v_secret uuid; begin
  if uid is null then return false; end if;
  insert into private.connections(user_id) values(uid) on conflict do nothing;
  select secret_id into v_secret from private.connections where user_id=uid and version=p_version for update;
  if not found then return false; end if;
  if p_key is not null then
    if v_secret is null then select vault.create_secret(p_key) into v_secret;
    else perform vault.update_secret(v_secret,p_key); end if;
  end if;
  if v_secret is null then return false; end if;
  update private.connections set secret_id=v_secret,model=p_model,version=version+1,tested_at=clock_timestamp(),status='connected' where user_id=uid;
  return true;
end $$;
create function private.disconnect() returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.scope(); v_secret uuid; begin
  select secret_id into v_secret from private.connections where user_id=uid for update;
  -- Increment a tombstone even for a not-yet-connected account, invalidating a concurrent save/test.
  insert into private.connections(user_id,version) values(uid,1)
  on conflict(user_id) do update set secret_id=null,version=private.connections.version+1,tested_at=null,status='disconnected';
  if v_secret is not null then delete from vault.secrets where id=v_secret; end if;
end $$;
create function private.connection_error(p_version integer) returns void language sql security definer set search_path='' as $$
  update private.connections set status='error' where user_id=private.scope() and version=p_version;
$$;
create function private.request_status(p_request uuid) returns table(fingerprint text,entry_id uuid) language sql security definer set search_path='' as $$
  select fingerprint,entry_id from private.requests where user_id=private.scope() and request_id=p_request;
$$;
create function private.reserve_query(p_request uuid) returns text language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.scope(); today date:=(clock_timestamp() at time zone 'UTC')::date; bucket timestamptz:=date_trunc('minute',clock_timestamp()); total integer;
begin
  if uid is null then return 'unauthorized'; end if;
  -- Short global lock makes per-user and service concurrency reservations atomic across instances.
  perform pg_advisory_xact_lock(710241);
  delete from private.leases where expires_at<=clock_timestamp();
  if exists(select 1 from private.leases where user_id=uid) then return 'busy'; end if;
  if (select count(*) from private.leases)>=5 then return 'busy'; end if;
  if coalesce((select count from private.usage where user_id=uid and day=today),0)>=100 then return 'daily'; end if;
  if coalesce((select count from private.minute_usage where user_id=uid and minute=bucket),0)>=10 then return 'minute'; end if;
  insert into private.usage values(uid,today,1) on conflict(user_id,day) do update set count=private.usage.count+1;
  insert into private.minute_usage values(uid,bucket,1) on conflict(user_id,minute) do update set count=private.minute_usage.count+1;
  insert into private.leases values(uid,p_request,clock_timestamp()+interval '60 seconds');
  return 'ok';
end $$;
create function private.release_query(p_request uuid) returns void language sql security definer set search_path='' as $$
  delete from private.leases where user_id=private.scope() and request_id=p_request;
$$;
create function private.lock_connection(p_version integer) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from private.connections where user_id=private.scope() and version=p_version and secret_id is not null for update;
  return found;
end $$;
create function private.complete_request(p_request uuid,p_fingerprint text,p_entry uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.entries where user_id=private.scope() and id=p_entry and request_id=p_request) then raise exception 'Invalid completion'; end if;
  if not exists(select 1 from private.leases where user_id=private.scope() and request_id=p_request and expires_at>clock_timestamp()) then raise exception 'Expired query lease'; end if;
  insert into private.requests values(private.scope(),p_request,p_fingerprint,p_entry);
end $$;
-- UTC retention and cleanup use the same row locks as favorite updates.
create function private.cleanup() returns void language plpgsql security definer set search_path='' as $$
begin
  delete from private.entries where not favorite and expires_at<=clock_timestamp();
  delete from private.sessions where expires_at<=clock_timestamp();
  delete from private.login_flows where expires_at<=clock_timestamp();
  delete from private.minute_usage where minute<clock_timestamp()-interval '1 day';
  delete from private.usage where day<(clock_timestamp() at time zone 'UTC')::date-28;
  delete from private.leases where expires_at<=clock_timestamp();
end $$;
revoke all on all tables in schema private from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.check_session(text), private.scope(), private.begin_login(text,text), private.consume_login(text), private.create_session(uuid,text,text), private.logout(text), private.connection_status(), private.read_credential(integer), private.save_connection(text,text,integer), private.disconnect(), private.connection_error(integer), private.request_status(uuid), private.reserve_query(uuid), private.release_query(uuid), private.lock_connection(integer), private.complete_request(uuid,text,uuid) to en_dic_runtime;
-- cleanup deliberately has no runtime grant. Enable pg_cron in Supabase before scheduling:
-- select cron.schedule('en-dic-expiry','17 3 * * *','select private.cleanup()');

-- Enable pg_cron in the dashboard before applying this migration.
do $$ begin
  if exists(select 1 from pg_namespace where nspname='cron') then
    perform cron.schedule('en-dic-expiry','17 3 * * *','select private.cleanup()');
  end if;
end $$;
