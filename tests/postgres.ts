import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { database } from '../apps/server/src/db.js';
import { hash } from '../apps/server/src/auth.js';
import { ALICE, BOB } from './database.js';
import { migrations, vaultStub } from './database-setup.js';

// Creates its own local, socket-only cluster; never accepts a connection URL or
// reads a product configuration. No external credentials or cloud DB required.
export async function postgresCluster() {
  const bin = process.env.EN_DIC_TEST_PG_BIN;
  const executable = (name: string) => bin ? join(bin, name) : name;
  if (bin && !existsSync(executable('initdb'))) throw new Error('EN_DIC_TEST_PG_BIN must contain initdb and pg_ctl');
  const root = mkdtempSync(join(tmpdir(), 'en-dic-postgres-'));
  const data = join(root, 'data'), socket = root;
  try {
    execFileSync(executable('initdb'), ['-D', data, '-U', 'en_dic_test_admin', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
    const quotedSocket = `'${socket.replaceAll("'", "'\\''")}'`;
    execFileSync(executable('pg_ctl'), ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${quotedSocket} -h '' -F`, '-w', 'start'], { stdio: 'pipe' });
  } catch {
    throw new Error('Local PostgreSQL test startup failed. Install PostgreSQL 17+ and set EN_DIC_TEST_PG_BIN to its bin directory; run as a non-root user. See TESTING.md.');
  }
  const config = { host: socket, user: 'en_dic_test_admin', database: 'postgres', options: '-c statement_timeout=10000 -c lock_timeout=5000 -c timezone=UTC' };
  const control = new pg.Pool(config);
  const pools: pg.Pool[] = [];
  const close = async () => {
    await Promise.all(pools.map(pool => pool.end()));
    await control.end();
    execFileSync(executable('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
    // Retain temporary artifacts for failure diagnosis; no recursive deletion.
  };
  try {
    await control.query('create role anon; create role authenticated; create role en_dic_test_runtime login nosuperuser nobypassrls');
  } catch (error) { await close(); throw error; }
  return {
    close,
    async fixture() {
      const name = `fixture_${randomUUID().replaceAll('-', '')}`;
      await control.query(`create database ${name}`);
      const admin = new pg.Pool({ ...config, database: name, max: 5 }); pools.push(admin);
      await admin.query(vaultStub);
      for (const migration of migrations()) await admin.query(migration);
      await admin.query('grant en_dic_runtime to en_dic_test_runtime');
      await admin.query('insert into private.invites(email,user_id) values($1,$2),($3,$4)', ['alice@example.invalid', ALICE, 'bob@example.invalid', BOB]);
      await admin.query("insert into private.sessions values($1,$2,clock_timestamp()+interval '7 days'),($3,$4,clock_timestamp()+interval '7 days')", [hash('alice-test-session'), ALICE, hash('bob-test-session'), BOB]);
      const runtime = new pg.Pool({ ...config, database: name, user: 'en_dic_test_runtime', max: 12 }); pools.push(runtime);
      const db = database(runtime);
      return { admin, runtime, db,
        async addUser(index: number) {
          const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, token = `fixture-session-${index}`;
          await admin.query('insert into private.invites(email,user_id) values($1,$2)', [`fixture-${index}@example.invalid`, id]);
          await admin.query("insert into private.sessions values($1,$2,clock_timestamp()+interval '7 days')", [hash(token), id]);
          return { id, session: hash(token) };
        },
        async close() { await runtime.end(); await admin.end(); pools.splice(pools.indexOf(runtime), 1); pools.splice(pools.indexOf(admin), 1); },
        async reservationClock(value: string) {
          // Test-only replacement in a fresh fixture DB; production has no
          // clock override. Keep the entire deployed function body unchanged.
          await admin.query('create table private.fixture_time(value timestamptz not null)');
          await admin.query('insert into private.fixture_time values($1)', [value]);
          await admin.query("create function private.fixture_clock() returns timestamptz language sql volatile security definer set search_path='' as $$ select value from private.fixture_time $$");
          const definition = (await admin.query("select pg_get_functiondef('private.reserve_query(uuid)'::regprocedure) as definition")).rows[0].definition;
          await admin.query(definition.replaceAll('clock_timestamp()', 'private.fixture_clock()'));
          return async (next: string) => { await admin.query('update private.fixture_time set value=$1', [next]); };
        },
      };
    },
  };
}

export async function waitForBlock(admin: pg.Pool, waiter: number, blocker: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = (await admin.query('select $2::int=any(pg_blocking_pids($1)) as blocked', [waiter, blocker])).rows[0];
    if (row.blocked) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL lock wait was not observed');
}
