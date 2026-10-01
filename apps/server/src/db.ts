import pg from 'pg';
import { unauthorized } from './errors.js';
export interface Sql { query<T = Record<string, any>>(sql: string, values?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>; }
export interface Database {
  system<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  user<T>(sessionHash: string, fn: (sql: Sql, userId: string) => Promise<T>): Promise<T>;
}
export function database(pool: pg.Pool): Database {
  const transaction = async <T>(fn: (sql: Sql) => Promise<T>) => {
    const client = await pool.connect();
    try { await client.query('begin'); const result = await fn(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  };
  return {
    system: transaction,
    user: (hash, fn) => transaction(async sql => {
      const { rows } = await sql.query<{ user_id: string }>('select user_id from private.check_session($1)', [hash]);
      if (!rows[0]) throw unauthorized();
      const id = rows[0].user_id;
      await sql.query("select set_config('app.user_id', $1, true)", [id]);
      await sql.query("select set_config('app.session_hash', $1, true)", [hash]);
      return fn(sql, id);
    }),
  };
}
export async function verifyRuntimeRole(sql: Sql) {
  const { rows } = await sql.query('select rolsuper, rolbypassrls from pg_roles where rolname=current_user');
  if (!rows[0] || rows[0].rolsuper || rows[0].rolbypassrls) throw new Error('Runtime database role must not be superuser or BYPASSRLS');
}
