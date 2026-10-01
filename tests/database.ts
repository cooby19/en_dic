import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { Database, Sql } from '../apps/server/src/db.js';
import { unauthorized } from '../apps/server/src/errors.js';
import { hash } from '../apps/server/src/auth.js';
export const ALICE = '00000000-0000-4000-8000-000000000001';
export const BOB = '00000000-0000-4000-8000-000000000002';
export const FAKE_KEY = 'fixture-only-not-a-real-key';
export async function testDatabase() {
  const pg = new PGlite();
  // Vault is a Supabase extension, unavailable in embedded Postgres. Only this extension boundary
  // is replaced; all private tables, security-definer functions, transactions, roles and RLS are real SQL.
  await pg.exec(`create role anon; create role authenticated;
    create schema vault;
    create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
    create view vault.decrypted_secrets as select id,secret,secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(value text) returns uuid language sql as $$ insert into vault.secrets(secret) values(value) returning id $$;
    create function vault.update_secret(secret_id uuid,value text) returns void language sql as $$ update vault.secrets set secret=value where id=secret_id $$;`);
  const migration = readFileSync(new URL('../supabase/migrations/20261001070225_dictionary_mvp.sql', import.meta.url), 'utf8');
  await pg.exec(migration.replace('create extension if not exists supabase_vault with schema vault;', ''));
  await pg.query('insert into private.invites(email,user_id) values($1,$2),($3,$4)', ['alice@example.invalid', ALICE, 'bob@example.invalid', BOB]);
  await pg.query("insert into private.sessions values($1,$2,clock_timestamp()+interval '7 days'),($3,$4,clock_timestamp()+interval '7 days')", [hash('alice-test-session'), ALICE, hash('bob-test-session'), BOB]);
  let queue = Promise.resolve();
  async function serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result;
  }
  const sql = { query: async (text: string, values?: any[]) => pg.query(text, values) } as Sql;
  async function tx<T>(fn: (sql: Sql) => Promise<T>) {
    await pg.exec('begin; set local role en_dic_runtime;');
    try { const result = await fn(sql); await pg.exec('commit;'); return result; }
    catch (error) { await pg.exec('rollback;'); throw error; }
  }
  const db: Database = {
    system: fn => serial(() => tx(fn)),
    user: (sessionHash, fn) => serial(() => tx(async sql => {
      const id = (await sql.query('select user_id from private.check_session($1)', [sessionHash])).rows[0]?.user_id;
      if (!id) throw unauthorized();
      await sql.query("select set_config('app.user_id',$1,true),set_config('app.session_hash',$2,true)", [id, sessionHash]);
      return fn(sql, id);
    })),
  };
  const admin = <T = Record<string, any>>(text: string, values?: any[]) => serial(() => pg.query<T>(text, values));
  const connect = (sessionToken = 'alice-test-session') => db.user(hash(sessionToken), async sql => { await sql.query('select private.save_connection($1,$2,0)', [FAKE_KEY, 'gemini-3.8-flash']); });
  return { db, admin, connect, close: () => pg.close() };
}
