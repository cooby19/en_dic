import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { migrate, readMigrations, migrationPrerequisites, type Migration } from '../scripts/migrate.js';
import { postgresCluster } from './postgres.js';

test('L09 migration runner: plans, all-or-nothing writes, checksums and concurrent reruns', async t => {
  const cluster = await postgresCluster();
  try {
    const f = await cluster.fixture({ migrate: false });
    const files = readMigrations().map(x => ({ ...x, sql: x.sql.replace('create extension if not exists supabase_vault with schema vault;', '') }));
    const client = await f.admin.connect();
    try {
      await t.test('read-only plan writes no history and apply commits every checked-in migration', async () => {
        assert.deepEqual((await migrate(client, files)).pending, files.map(x => x.version));
        assert.equal((await client.query("select to_regclass('en_dic_migrations.history') as history")).rows[0].history, null);
        assert.deepEqual((await migrate(client, files, true)).applied, files.map(x => x.version));
        assert.equal((await client.query('select count(*)::int as n from en_dic_migrations.history')).rows[0].n, files.length);
        assert.equal((await client.query("select to_regprocedure('private.reserve_query(uuid)') as fn")).rows[0].fn, 'private.reserve_query(uuid)');
      });
      await t.test('concurrent reruns serialize, skip applied files and preserve history', async () => {
        const other = await f.admin.connect();
        try { const results = await Promise.all([migrate(client, files, true), migrate(other, files, true)]); assert.ok(results.every(x => x.applied.length === 0)); }
        finally { other.release(); }
      });
      await t.test('changed, missing or unknown migration history is rejected', async () => {
        await assert.rejects(migrate(client, [{ ...files[0], checksum: 'changed' }, ...files.slice(1)], true), /differs/);
        await assert.rejects(migrate(client, files.slice(1), true), /differs/);
        await assert.rejects(migrate(client, [], true), /differs/);
        assert.equal((await client.query('select count(*)::int as n from en_dic_migrations.history')).rows[0].n, files.length);
      });
      await t.test('SQL failure rolls back DDL and history for the whole batch', async () => {
        const item = (version: string, sql: string): Migration => ({ version, name: 'fixture', sql, checksum: createHash('sha256').update(sql).digest('hex') });
        await assert.rejects(migrate(client, [...files, item('20261002080001','create table public.rollback_fixture(id int)'), item('20261002080002','select fixture_missing_function()')], true));
        assert.equal((await client.query("select to_regclass('public.rollback_fixture') as fixture")).rows[0].fixture, null);
        assert.equal((await client.query('select count(*)::int as n from en_dic_migrations.history')).rows[0].n, files.length);
      });
      await t.test('cloud apply preflight refuses missing Vault/Cron', async () => { await assert.rejects(migrationPrerequisites(client), /Vault and pg_cron/); });
      await t.test('cloud apply preflight rejects the dedicated runtime login', async () => {
        await client.query('grant en_dic_runtime to en_dic_test_runtime');
        const runtime = await f.runtime.connect();
        try { await assert.rejects(migrationPrerequisites(runtime), /runtime login/); }
        finally { runtime.release(); }
      });
    } finally { client.release(); await f.close(); }
    await t.test('existing schema without history is never silently adopted', async () => {
      const old = await cluster.fixture(); const connection = await old.admin.connect();
      try { await assert.rejects(migrate(connection, files, true), /reconcile/); }
      finally { connection.release(); await old.close(); }
    });
  } finally { await cluster.close(); }
});
