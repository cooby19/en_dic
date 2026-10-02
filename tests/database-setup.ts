import { readdirSync, readFileSync } from 'node:fs';

// Only the Supabase Vault extension boundary is a fixture. Roles, RLS,
// functions and every checked-in migration execute as PostgreSQL SQL.
export const vaultStub = `create schema vault;
  create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
  create view vault.decrypted_secrets as select id,secret,secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(value text) returns uuid language sql as $$ insert into vault.secrets(secret) values(value) returning id $$;
  create function vault.update_secret(secret_id uuid,value text) returns void language sql as $$ update vault.secrets set secret=value where id=secret_id $$;`;

export function migrations() {
  const directory = new URL('../supabase/migrations/', import.meta.url);
  return readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name =>
    readFileSync(new URL(name, directory), 'utf8').replace('create extension if not exists supabase_vault with schema vault;', ''));
}
