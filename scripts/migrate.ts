import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { externalJson, externalPath, projectRoot } from '../apps/server/src/config.js';

export interface Migration { version: string; name: string; sql: string; checksum: string; }
export function readMigrations(directory = resolve(projectRoot, 'supabase/migrations')): Migration[] {
  const versions = new Set<string>();
  return readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(file => {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match || versions.has(match[1])) throw new Error('Invalid or duplicate migration version');
    versions.add(match[1]); const sql = readFileSync(resolve(directory, file), 'utf8');
    if (!sql.trim()) throw new Error('Empty migration');
    return { version: match[1], name: match[2], sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}
// This runner owns en_dic_migrations.history; do not mix it with CLI db push.
// One transaction and one advisory lock cover the complete batch and history.
export async function migrate(client: pg.PoolClient, files: Migration[], apply = false) {
  await client.query(apply ? 'begin' : 'begin read only');
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('en-dic-migrations'))");
    const exists = (await client.query("select to_regclass('en_dic_migrations.history') as history, to_regclass('private.entries') as entries")).rows[0];
    if (!exists.history && exists.entries) throw new Error('Existing product schema has no runner history; reconcile migration history before applying');
    const history = exists.history ? (await client.query('select version,name,checksum from en_dic_migrations.history order by version')).rows : [];
    for (const [i, applied] of history.entries()) {
      const file = files[i];
      if (!file || file.version !== applied.version || file.name !== applied.name || file.checksum !== applied.checksum) throw new Error('Migration history differs from checked-in files; no changes applied');
    }
    const pending = files.slice(history.length);
    if (apply) {
      await client.query('create schema if not exists en_dic_migrations');
      await client.query('revoke all on schema en_dic_migrations from public');
      await client.query('create table if not exists en_dic_migrations.history(version text primary key,name text not null,checksum text not null,applied_at timestamptz not null default clock_timestamp())');
      await client.query('revoke all on en_dic_migrations.history from public');
      for (const file of pending) {
        await client.query(file.sql);
        await client.query('insert into en_dic_migrations.history(version,name,checksum) values($1,$2,$3)', [file.version, file.name, file.checksum]);
      }
    }
    await client.query('commit');
    return { applied: apply ? pending.map(x => x.version) : [], pending: apply ? [] : pending.map(x => x.version) };
  } catch (error) { await client.query('rollback'); throw error; }
}

export async function migrationPrerequisites(client: pg.PoolClient) {
  const roles = (await client.query(`with recursive memberships(oid) as (
    select oid from pg_roles where rolname=current_user
    union select m.roleid from pg_auth_members m join memberships p on m.member=p.oid
  ) select exists(select 1 from memberships m join pg_roles r on r.oid=m.oid where r.rolname='en_dic_runtime') as runtime`)).rows;
  if (roles.some(x => x.runtime)) throw new Error('Use a separate migration administrator, not the runtime login');
  const extensions = (await client.query("select extname from pg_extension where extname in ('supabase_vault','pg_cron')")).rows.map(x => x.extname);
  if (!extensions.includes('supabase_vault') || !extensions.includes('pg_cron')) throw new Error('Enable Supabase Vault and pg_cron before applying migrations');
}
async function main() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, list: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('npm run migrate -- [--list | --apply]\nDefault: read-only plan. EN_DIC_MIGRATION_CONFIG: external JSON with databaseUrl; --apply also requires backupPath to an external, nonempty encrypted .age backup. Enable Vault and pg_cron first.'); return; }
  const files = readMigrations();
  if (values.list && values.apply) throw new Error('Choose list or apply');
  if (values.list) { console.log(JSON.stringify(files.map(({ version, name, checksum }) => ({ version, name, checksum })), null, 2)); return; }
  const path = process.env.EN_DIC_MIGRATION_CONFIG;
  if (!path) throw new Error('Set EN_DIC_MIGRATION_CONFIG to external administrator configuration');
  const config = externalJson(path);
  if (typeof config.databaseUrl !== 'string' || !/^postgres(?:ql)?:\/\//.test(config.databaseUrl)) throw new Error('Migration configuration needs databaseUrl');
  if (values.apply) {
    if (typeof config.backupPath !== 'string' || !config.backupPath.endsWith('.age')) throw new Error('An external encrypted pre-migration backupPath is required');
    const backup = statSync(externalPath(config.backupPath));
    if (!backup.isFile() || backup.size === 0) throw new Error('Pre-migration backup must be a nonempty encrypted file');
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10000, options: '-c statement_timeout=60000 -c lock_timeout=10000' });
  try {
    const client = await pool.connect();
    try { if (values.apply) await migrationPrerequisites(client); console.log(JSON.stringify(await migrate(client, files, values.apply))); }
    finally { client.release(); }
  } finally { await pool.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) void main().catch(() => {
  // pg and filesystem errors can contain credentials, connection URLs or SQL.
  console.error('Migration failed; check external administrator configuration, backup, extensions and migration history. No connection details are logged.'); process.exitCode = 1;
});
