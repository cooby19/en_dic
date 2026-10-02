import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { postgresCluster, waitForBlock } from './postgres.js';
import { ALICE, BOB, FAKE_KEY } from './database.js';
import { hash } from '../apps/server/src/auth.js';
import { verifyRuntimeRole } from '../apps/server/src/db.js';
import { buildApp } from '../apps/server/src/app.js';
import type { Analysis } from '@en-dic/shared';

const alice = hash('alice-test-session'), bob = hash('bob-test-session');
const analysis: Analysis = { kind: 'word', translation: '你好', ambiguity: '', partOfSpeech: '感嘆詞', usage: '打招呼', meanings: ['你好'] };
type Fixture = Awaited<ReturnType<Awaited<ReturnType<typeof postgresCluster>>['fixture']>>;
const reserve = (f: Fixture, session = alice, id = randomUUID()) => f.db.user(session, async sql => (await sql.query('select private.reserve_query($1) as result', [id])).rows[0].result as string);
const release = (f: Fixture, id: string, session = alice) => f.db.user(session, sql => sql.query('select private.release_query($1)', [id]));
async function usage(f: Fixture, id = ALICE) {
  return (await f.admin.query('select coalesce(sum(count),0)::int as total from private.usage where user_id=$1', [id])).rows[0].total;
}
async function scoped(client: pg.PoolClient, session = alice, id = ALICE) {
  await client.query('begin');
  await client.query("select set_config('app.user_id',$1,true),set_config('app.session_hash',$2,true)", [id, session]);
}
const pid = async (client: pg.PoolClient) => (await client.query('select pg_backend_pid() as pid')).rows[0].pid as number;
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function appFixture(f: Fixture) {
  const app = await buildApp({ db: f.db, origin: 'https://dictionary.example.invalid', auth: { authorize: () => '', exchange: async () => ({ id: ALICE, email: 'alice@example.invalid' }) }, analyzer: { models: () => ['gemini-3.8-flash'], analyze: async () => analysis } });
  const patch = (id: string, favorite: boolean) => app.inject({ method: 'PATCH', url: `/api/entries/${id}`, headers: { origin: 'https://dictionary.example.invalid', cookie: '__Host-en-dic-session=alice-test-session' }, payload: { favorite } });
  return { app, patch };
}
async function insertEntry(f: Fixture, favorite = false) {
  return (await f.admin.query(`insert into private.entries(user_id,request_id,original,normalized,normalized_context,analysis,model,favorite,favorited_at,expires_at)
    values($1,$2,'hello','hello','',$3,'gemini-3.8-flash',$4,case when $4 then clock_timestamp() end,case when $4 then null else clock_timestamp()+interval '1 day' end) returning id`, [ALICE, randomUUID(), JSON.stringify(analysis), favorite])).rows[0].id as string;
}
function pauseNextEntryUpdate(f: Fixture) {
  const original = f.db.user, updated = deferred<{ pid: number; rows: any[] }>(), resume = deferred();
  let held = false;
  f.db.user = (session, fn) => original(session, (sql, id) => fn({ query: async <T = Record<string, any>>(text: string, values?: any[]) => {
    const hold = !held && text.startsWith('update private.entries set');
    if (hold) held = true;
    const backend = hold ? (await sql.query('select pg_backend_pid() as pid')).rows[0].pid : 0;
    const result = await sql.query<T>(text, values);
    if (hold) { updated.resolve({ pid: backend, rows: result.rows }); await resume.promise; }
    return result;
  } }, id));
  return { updated: updated.promise, resume: () => resume.resolve(), restore: () => { f.db.user = original; } };
}
async function waitUntilExpired(f: Fixture, id: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if ((await f.admin.query('select expires_at<=clock_timestamp() as expired from private.entries where id=$1', [id])).rows[0].expired) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture entry did not expire');
}

test('L04/L05: real PostgreSQL quotas, authorization and concurrent transactions', { timeout: 120000 }, async t => {
  const cluster = await postgresCluster();
  t.after(() => cluster.close());
  async function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
    await t.test(name, async () => {
      const f = await cluster.fixture();
      try { await fn(f); } finally { await f.close(); }
    });
  }

  await scenario('minute boundary: tenth accepted, eleventh rejected without charging, next minute accepted', async f => {
    const advance = await f.reservationClock('2026-10-02T12:00:59Z');
    for (let n = 0; n < 10; n++) { const id = randomUUID(); assert.equal(await reserve(f, alice, id), 'ok'); await release(f, id); }
    assert.equal(await reserve(f), 'minute'); assert.equal(await usage(f), 10);
    assert.equal((await f.admin.query('select count(*)::int as total from private.leases')).rows[0].total, 0);
    await advance('2026-10-02T12:01:00Z');
    assert.equal(await reserve(f), 'ok'); assert.equal(await usage(f), 11);
  });
  await scenario('daily boundary: hundredth accepted, next rejected; UTC midnight resets in a non-UTC session', async f => {
    const advance = await f.reservationClock('2026-10-02T23:59:59Z');
    await f.admin.query("insert into private.usage values($1,'2026-10-02',99)", [ALICE]);
    const client = await f.runtime.connect();
    try {
      await client.query("set time zone 'Asia/Taipei'"); await scoped(client);
      const id = randomUUID();
      assert.equal((await client.query('select private.reserve_query($1) as result', [id])).rows[0].result, 'ok');
      await client.query('select private.release_query($1)', [id]); await client.query('commit');
      assert.equal(await reserve(f), 'daily'); assert.equal(await usage(f), 100);
      await advance('2026-10-03T00:00:00Z');
      await scoped(client);
      assert.equal((await client.query('select private.reserve_query($1) as result', [randomUUID()])).rows[0].result, 'ok');
      await client.query('commit');
      const days = (await f.admin.query("select day::text,count from private.usage order by day")).rows;
      assert.deepEqual(days, [{ day: '2026-10-02', count: 100 }, { day: '2026-10-03', count: 1 }]);
      assert.equal((await f.admin.query("select count from private.minute_usage where minute='2026-10-03T00:00:00Z'")).rows[0].count, 1);
    } finally { await client.query('rollback'); client.release(); }
  });
  await scenario('reservation waiting across UTC midnight charges only the post-lock bucket', async f => {
    const advance = await f.reservationClock('2026-10-02T23:59:59Z');
    const blocker = await f.admin.connect(), waiter = await f.runtime.connect();
    try {
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(710241)');
      await scoped(waiter); const waiterPid = await pid(waiter), blockerPid = await pid(blocker); const waiting = waiter.query('select private.reserve_query($1) as result', [randomUUID()]);
      await waitForBlock(f.admin, waiterPid, blockerPid);
      await advance('2026-10-03T00:00:00Z'); await blocker.query('commit');
      assert.equal((await waiting).rows[0].result, 'ok'); await waiter.query('commit');
      assert.deepEqual((await f.admin.query('select day::text,count from private.usage')).rows, [{ day: '2026-10-03', count: 1 }]);
      assert.equal((await f.admin.query('select expires_at::text from private.leases')).rows[0].expires_at, '2026-10-03 00:01:00+00');
    } finally { await blocker.query('rollback'); await waiter.query('rollback'); blocker.release(); waiter.release(); }
  });
  await scenario('one user: simultaneous independent connections admit exactly one request', async f => {
    const ids = Array.from({ length: 6 }, () => randomUUID());
    const results = await Promise.all(ids.map(id => reserve(f, alice, id)));
    assert.equal(results.filter(value => value === 'ok').length, 1);
    assert.equal(results.filter(value => value === 'busy').length, 5); assert.equal(await usage(f), 1);
    const owner = ids[results.indexOf('ok')];
    await release(f, randomUUID()); assert.equal(await reserve(f), 'busy');
    await release(f, owner); assert.equal(await reserve(f), 'ok');
  });
  await scenario('reservation waiting across a minute boundary obeys the new minute cap', async f => {
    const advance = await f.reservationClock('2026-10-02T12:00:59Z');
    await f.admin.query("insert into private.minute_usage values($1,'2026-10-02T12:01:00Z',10)", [ALICE]);
    const blocker = await f.admin.connect(), waiter = await f.runtime.connect();
    try {
      const blockerPid = await pid(blocker), waiterPid = await pid(waiter);
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(710241)'); await scoped(waiter);
      const waiting = waiter.query('select private.reserve_query($1) as result', [randomUUID()]);
      await waitForBlock(f.admin, waiterPid, blockerPid);
      await advance('2026-10-02T12:01:00Z'); await blocker.query('commit');
      assert.equal((await waiting).rows[0].result, 'minute'); await waiter.query('commit');
      assert.equal(await usage(f), 0);
      assert.equal((await f.admin.query('select count(*)::int as total from private.leases')).rows[0].total, 0);
    } finally { await blocker.query('rollback'); await waiter.query('rollback'); blocker.release(); waiter.release(); }
  });
  await scenario('service cap: simultaneous users across connections admit exactly five, then recover after release', async f => {
    const users = await Promise.all(Array.from({ length: 8 }, (_, n) => f.addUser(n + 3)));
    const ids = users.map(() => randomUUID());
    const results = await Promise.all(users.map((user, n) => reserve(f, user.session, ids[n])));
    assert.equal(results.filter(value => value === 'ok').length, 5); assert.equal(results.filter(value => value === 'busy').length, 3);
    assert.equal((await f.admin.query('select sum(count)::int as total from private.usage')).rows[0].total, 5);
    const owner = results.indexOf('ok'), blocked = results.indexOf('busy');
    await release(f, ids[owner], users[owner].session);
    assert.equal(await reserve(f, users[blocked].session), 'ok');
    assert.equal((await f.admin.query('select count(*)::int as total from private.leases')).rows[0].total, 5);
  });
  for (const invalidate of ['disconnect', 'revoke', 'logout'] as const) await scenario(`lease survives ${invalidate} safely and is reclaimed at its exact expiration`, async f => {
    const advance = await f.reservationClock('2026-10-02T12:00:00Z'), id = randomUUID();
    await f.db.user(alice, sql => sql.query('select private.save_connection($1,$2,0)', [FAKE_KEY, 'gemini-3.8-flash']));
    assert.equal(await reserve(f, alice, id), 'ok');
    if (invalidate === 'disconnect') await f.db.user(alice, sql => sql.query('select private.disconnect()'));
    if (invalidate === 'revoke') await f.admin.query('update private.invites set active=false where user_id=$1', [ALICE]);
    if (invalidate === 'logout') await f.db.system(sql => sql.query('select private.logout($1)', [alice]));
    if (invalidate !== 'disconnect') await assert.rejects(release(f, id), error => (error as any).code === 'UNAUTHORIZED');
    await advance('2026-10-02T12:00:59.999Z');
    assert.equal(await reserve(f, bob), 'ok');
    assert.equal((await f.admin.query('select count(*)::int as total from private.leases where user_id=$1', [ALICE])).rows[0].total, 1);
    await advance('2026-10-02T12:01:00Z'); const third = await f.addUser(3); assert.equal(await reserve(f, third.session), 'ok');
    assert.equal((await f.admin.query('select count(*)::int as total from private.leases where user_id=$1', [ALICE])).rows[0].total, 0);
    if (invalidate === 'disconnect') {
      const newer = randomUUID(); assert.equal(await reserve(f, alice, newer), 'ok'); await release(f, id);
      assert.equal((await f.admin.query('select request_id from private.leases where user_id=$1', [ALICE])).rows[0].request_id, newer);
    }
  });
  await scenario('invitation revoked while waiting for reservation is rechecked after the lock', async f => {
    const blocker = await f.admin.connect(), waiter = await f.runtime.connect();
    try {
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(710241)'); await scoped(waiter);
      const waiterPid = await pid(waiter), blockerPid = await pid(blocker);
      const waiting = waiter.query('select private.reserve_query($1) as result', [randomUUID()]);
      await waitForBlock(f.admin, waiterPid, blockerPid);
      await f.admin.query('update private.invites set active=false where user_id=$1', [ALICE]); await blocker.query('commit');
      assert.equal((await waiting).rows[0].result, 'unauthorized'); await waiter.query('commit'); assert.equal(await usage(f), 0);
    } finally { await blocker.query('rollback'); await waiter.query('rollback'); blocker.release(); waiter.release(); }
  });
  await scenario('API reports 401 when invitation is revoked during reservation, without invoking the model', async f => {
    await f.db.user(alice, sql => sql.query('select private.save_connection($1,$2,0)', [FAKE_KEY, 'gemini-3.8-flash']));
    let calls = 0;
    const app = await buildApp({ db: f.db, origin: 'https://dictionary.example.invalid', auth: { authorize: () => '', exchange: async () => ({ id: ALICE, email: 'alice@example.invalid' }) }, analyzer: { models: () => ['gemini-3.8-flash'], analyze: async () => { calls++; return analysis; } } });
    const original = f.db.user, reserving = deferred<number>();
    f.db.user = (session, fn) => original(session, (sql, id) => fn({ query: async <T = Record<string, any>>(text: string, values?: any[]) => {
      if (text.includes('private.reserve_query')) reserving.resolve((await sql.query('select pg_backend_pid() as pid')).rows[0].pid);
      return sql.query<T>(text, values);
    } }, id));
    const blocker = await f.admin.connect();
    let requesting: Promise<{ statusCode: number; json(): any }> | undefined;
    try {
      const blockerPid = await pid(blocker);
      await blocker.query('begin'); await blocker.query('select pg_advisory_xact_lock(710241)');
      requesting = app.inject({ method: 'POST', url: '/api/query', headers: { origin: 'https://dictionary.example.invalid', cookie: '__Host-en-dic-session=alice-test-session' }, payload: { requestId: randomUUID(), original: 'hello' } });
      await waitForBlock(f.admin, await reserving.promise, blockerPid);
      await f.admin.query('update private.invites set active=false where user_id=$1', [ALICE]); await blocker.query('commit');
      const result = await requesting; assert.equal(result.statusCode, 401); assert.equal(result.json().error.code, 'UNAUTHORIZED'); assert.equal(calls, 0);
      assert.equal(await usage(f), 0);
    } finally { await blocker.query('rollback'); f.db.user = original; await Promise.allSettled([requesting]); blocker.release(); await app.close(); }
  });
  await scenario('expired lease cannot complete a request; failed completion rolls back the inserted entry', async f => {
    const request = randomUUID(); assert.equal(await reserve(f, alice, request), 'ok');
    await f.admin.query("update private.leases set expires_at=clock_timestamp()-interval '1 second' where user_id=$1", [ALICE]);
    await assert.rejects(f.db.user(alice, async sql => {
      const row = (await sql.query('insert into private.entries(user_id,request_id,original,normalized,normalized_context,analysis,model) values($1,$2,$3,$3,$4,$5,$6) returning id', [ALICE, request, 'hello', '', JSON.stringify(analysis), 'gemini-3.8-flash'])).rows[0];
      await sql.query('select private.complete_request($1,$2,$3)', [request, 'fixture-fingerprint', row.id]);
    }), /Expired query lease/);
    assert.equal((await f.admin.query('select count(*)::int as total from private.entries')).rows[0].total, 0);
    assert.equal((await f.admin.query('select count(*)::int as total from private.requests')).rows[0].total, 0);
    assert.equal(await reserve(f), 'ok');
  });

  await scenario('runtime SQL permissions, forged scope, cross-account writes, revoked scope and transaction reset', async f => {
    const id = await insertEntry(f);
    await verifyRuntimeRole(f.runtime);
    await assert.rejects(verifyRuntimeRole(f.admin), /must not be superuser/);
    for (const table of ['invites', 'sessions', 'login_flows', 'connections', 'usage', 'leases', 'requests', 'minute_usage']) {
      for (const sql of [`select * from private.${table}`, `delete from private.${table}`]) await assert.rejects(f.runtime.query(sql), error => (error as any).code === '42501');
    }
    for (const sql of ['select * from vault.decrypted_secrets', 'select * from vault.secrets', 'select private.cleanup()', 'set role en_dic_test_admin']) await assert.rejects(f.runtime.query(sql), error => (error as any).code === '42501');
    for (const role of ['anon', 'authenticated']) {
      const c = await f.admin.connect();
      try {
        await c.query('begin'); await c.query(`set local role ${role}`);
        await assert.rejects(c.query('select private.check_session($1)', [alice]), error => (error as any).code === '42501');
      } finally { await c.query('rollback'); c.release(); }
    }
    assert.equal((await f.runtime.query('select * from private.entries')).rows.length, 0);
    assert.equal((await f.runtime.query('select private.reserve_query($1) as result', [randomUUID()])).rows[0].result, 'unauthorized');
    const c = await f.runtime.connect();
    try {
      await scoped(c, alice, BOB);
      assert.equal((await c.query('select private.scope() as id')).rows[0].id, null);
      assert.equal((await c.query('select * from private.entries')).rows.length, 0); await c.query('rollback');
    } finally { c.release(); }
    assert.equal((await f.db.user(bob, sql => sql.query('update private.entries set notes=$2 where id=$1 returning id', [id, 'forged']))).rows.length, 0);
    await assert.rejects(f.db.user(alice, sql => sql.query('update private.entries set user_id=$2 where id=$1', [id, BOB])), error => (error as any).code === '42501');
    assert.equal((await f.db.user(alice, sql => sql.query('select id from private.entries'))).rows[0].id, id);
    assert.equal((await f.runtime.query('select * from private.entries')).rows.length, 0, 'transaction scope does not leak to a reused connection');
    await f.admin.query('update private.invites set active=false where user_id=$1', [ALICE]);
    const revoked = await f.runtime.connect();
    try { await scoped(revoked); assert.equal((await revoked.query('select * from private.entries')).rows.length, 0); } finally { await revoked.query('rollback'); revoked.release(); }
    const functions = (await f.admin.query("select p.proname,p.proconfig,has_function_privilege('public',p.oid,'execute') as exposed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef")).rows;
    for (const fn of functions) { assert.equal(fn.exposed, false, fn.proname); assert.ok(fn.proconfig.some((config: string) => config.startsWith('search_path=')), fn.proname); }
  });

  await scenario('favorite commits first: cleanup waits on its row lock and preserves the newly favorited record', async f => {
    const id = await insertEntry(f), web = await appFixture(f), hold = pauseNextEntryUpdate(f);
    const cleaner = await f.admin.connect();
    let saving: ReturnType<typeof web.patch> | undefined;
    let cleaning: Promise<pg.QueryResult> | undefined;
    try {
      const cleanerPid = await pid(cleaner);
      await f.admin.query("update private.entries set expires_at=clock_timestamp()+interval '500 milliseconds' where id=$1", [id]);
      saving = web.patch(id, true); const saved = await hold.updated;
      assert.equal(saved.rows[0].favorite, true); assert.equal(saved.rows[0].expires_at, null);
      await waitUntilExpired(f, id);
      cleaning = cleaner.query('select private.cleanup()');
      await waitForBlock(f.admin, cleanerPid, saved.pid);
      hold.resume(); const result = await saving; await cleaning;
      assert.equal(result.statusCode, 200); assert.equal(result.json().favorite, true);
      const persisted = (await f.admin.query('select favorite,expires_at from private.entries where id=$1', [id])).rows;
      assert.deepEqual(persisted, [{ favorite: true, expires_at: null }]);
    } finally { hold.resume(); hold.restore(); await Promise.allSettled([saving, cleaning]); cleaner.release(); await web.app.close(); }
  });
  await scenario('favorite rolls back: cleanup waiting on the same row deletes the expired original', async f => {
    const id = await insertEntry(f), writer = await f.runtime.connect(), cleaner = await f.admin.connect();
    let cleaning: Promise<pg.QueryResult> | undefined;
    try {
      const writerPid = await pid(writer), cleanerPid = await pid(cleaner);
      await f.admin.query("update private.entries set expires_at=clock_timestamp()+interval '300 milliseconds' where id=$1", [id]);
      await scoped(writer);
      assert.equal((await writer.query('update private.entries set favorite=true,favorited_at=clock_timestamp(),expires_at=null where id=$1 returning id', [id])).rows.length, 1);
      await waitUntilExpired(f, id);
      cleaning = cleaner.query('select private.cleanup()'); await waitForBlock(f.admin, cleanerPid, writerPid);
      await writer.query('rollback'); await cleaning;
      assert.equal((await f.admin.query('select id from private.entries where id=$1', [id])).rows.length, 0);
    } finally { await writer.query('rollback'); await Promise.allSettled([cleaning]); writer.release(); cleaner.release(); }
  });
  await scenario('cleanup commits first: a favorite request already waiting on that row returns 404 without resurrection', async f => {
    const id = await insertEntry(f), web = await appFixture(f), cleaner = await f.admin.connect();
    const original = f.db.user, updating = deferred<number>();
    f.db.user = (session, fn) => original(session, (sql, owner) => fn({ query: async <T = Record<string, any>>(text: string, values?: any[]) => {
      if (text.startsWith('update private.entries set')) updating.resolve((await sql.query('select pg_backend_pid() as pid')).rows[0].pid);
      return sql.query<T>(text, values);
    } }, owner));
    let saving: ReturnType<typeof web.patch> | undefined;
    try {
      const cleanerPid = await pid(cleaner);
      await cleaner.query('begin'); await cleaner.query('select id from private.entries where id=$1 for update', [id]);
      saving = web.patch(id, true);
      await waitForBlock(f.admin, await updating.promise, cleanerPid);
      // The favorite saw the live row and is blocked. Expiry and cleanup now
      // happen on the locking connection before the favorite can acquire it.
      await cleaner.query("update private.entries set expires_at=clock_timestamp()-interval '1 second' where id=$1", [id]);
      await cleaner.query('select private.cleanup()'); await cleaner.query('commit');
      const result = await saving; assert.equal(result.statusCode, 404); assert.equal(result.json().error.code, 'NOT_FOUND');
      assert.equal((await f.admin.query('select id from private.entries where id=$1', [id])).rows.length, 0);
    } finally { await cleaner.query('rollback'); f.db.user = original; await Promise.allSettled([saving]); cleaner.release(); await web.app.close(); }
  });
  await scenario('unfavorite overlaps cleanup: new retention is fourteen UTC days and survives both cleanup snapshots', async f => {
    const id = await insertEntry(f, true), web = await appFixture(f), hold = pauseNextEntryUpdate(f);
    let saving: ReturnType<typeof web.patch> | undefined;
    try {
      const started = Date.now(); saving = web.patch(id, false); const changed = await hold.updated;
      assert.equal(changed.rows[0].favorite, false);
      assert.ok(Math.abs(changed.rows[0].expires_at.getTime() - started - 336 * 3600000) < 1000);
      await f.admin.query('select private.cleanup()'); // the uncommitted row remains a favorite in this snapshot
      hold.resume(); const result = await saving; assert.equal(result.statusCode, 200);
      await f.admin.query('select private.cleanup()');
      const row = (await f.admin.query('select favorite,favorited_at,expires_at from private.entries where id=$1', [id])).rows[0];
      assert.equal(row.favorite, false); assert.equal(row.favorited_at, null); assert.equal(row.expires_at.toISOString(), result.json().expiresAt);
    } finally { hold.resume(); hold.restore(); await Promise.allSettled([saving]); await web.app.close(); }
  });
  await scenario('two concurrent unfavorites share the first expiry instead of extending retention after a lock wait', async f => {
    const id = await insertEntry(f, true), web = await appFixture(f), hold = pauseNextEntryUpdate(f);
    const first = web.patch(id, false); const changed = await hold.updated;
    const original = f.db.user, secondPid = deferred<number>();
    f.db.user = (session, fn) => original(session, (sql, owner) => fn({ query: async <T = Record<string, any>>(text: string, values?: any[]) => {
      if (text.startsWith('update private.entries set')) secondPid.resolve((await sql.query('select pg_backend_pid() as pid')).rows[0].pid);
      return sql.query<T>(text, values);
    } }, owner));
    let second: ReturnType<typeof web.patch> | undefined;
    try {
      second = web.patch(id, false); await waitForBlock(f.admin, await secondPid.promise, changed.pid);
      hold.resume(); const [a, b] = await Promise.all([first, second]);
      assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
      assert.equal(a.json().expiresAt, b.json().expiresAt);
      assert.equal((await f.admin.query('select expires_at from private.entries where id=$1', [id])).rows[0].expires_at.toISOString(), a.json().expiresAt);
      await f.admin.query('select private.cleanup()'); assert.equal((await f.admin.query('select id from private.entries where id=$1', [id])).rows.length, 1);
    } finally { hold.resume(); hold.restore(); await Promise.allSettled([first, second]); await web.app.close(); }
  });
});
