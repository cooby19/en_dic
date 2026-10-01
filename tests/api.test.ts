import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../apps/server/src/app.js';
import { AppError } from '../apps/server/src/errors.js';
import { testDatabase, ALICE, BOB, FAKE_KEY } from './database.js';
import type { ModelInput } from '../apps/server/src/model.js';
import type { Analysis } from '@en-dic/shared';
const analysis: Analysis = { kind: 'word', translation: '你好', ambiguity: '', partOfSpeech: '感嘆詞', usage: '打招呼', meanings: ['你好'] };
async function setup(analyze: (input: ModelInput) => Promise<Analysis> = async input => {
  assert.equal((await input.credentials.read('google') as { key: string }).key, FAKE_KEY); return analysis;
}, timeoutMs?: number) {
  const data = await testDatabase(); await data.connect();
  const app = await buildApp({ db: data.db, origin: 'https://dictionary.example.invalid', timeoutMs, auth: { authorize: (_v, callback) => `https://auth.example.invalid/?redirect=${encodeURIComponent(callback)}`, exchange: async code => ({ id: code === 'bob' ? BOB : ALICE, email: `${code === 'bob' ? 'bob' : 'alice'}@example.invalid` }) }, analyzer: { models: () => ['gemini-3.8-flash'], analyze } });
  const call = (method: any, url: string, payload?: unknown, who = 'alice') => app.inject({ method, url, headers: { origin: 'https://dictionary.example.invalid', cookie: `__Host-en-dic-session=${who}-test-session` }, ...(payload ? { payload } : {}) });
  return { ...data, app, call, close: async () => { await app.close(); await data.close(); } };
}
const query = (original = ' hello ', context = '') => ({ original, context, requestId: randomUUID() });

test('successful queries preserve input, deduplicate retries and offer existing favorites without overwriting', async () => {
  let calls = 0; const f = await setup(async () => { calls++; return analysis; });
  try {
    const input = query('  café\n '), result = await f.call('POST', '/api/query', input);
    assert.equal(result.statusCode, 200); const first = result.json().entry; assert.equal(first.original, input.original); assert.equal(first.analysisVersion, 1);
    assert.ok(Math.abs(Date.parse(first.expiresAt) - Date.parse(first.createdAt) - 336 * 3600000) < 10);
    const saved = await f.call('PATCH', `/api/entries/${first.id}`, { favorite: true, notes: 'fixture note', source: 'fixture source' }); assert.equal(saved.json().expiresAt, null);
    assert.equal((await f.call('POST', '/api/query', input)).json().entry.id, first.id); assert.equal(calls, 1);
    assert.equal((await f.call('POST', '/api/query', { ...input, original: 'different' })).statusCode, 409);
    const next = (await f.call('POST', '/api/query', query('cafe\u0301'))).json(); assert.deepEqual(next.existingFavorites, [first.id]); assert.notEqual(next.entry.id, first.id);
    assert.equal((await f.call('GET', `/api/entries/${first.id}`)).json().notes, 'fixture note');
    assert.deepEqual((await f.call('POST', '/api/query', query('Café'))).json().existingFavorites, []);
    assert.deepEqual((await f.call('POST', '/api/query', query('café', 'different context'))).json().existingFavorites, []);
    const un = (await f.call('PATCH', `/api/entries/${first.id}`, { favorite: false })).json(); assert.ok(Date.parse(un.expiresAt) - Date.now() > 335.99 * 3600000);
    const expiry = un.expiresAt; const again = (await f.call('PATCH', `/api/entries/${first.id}`, { favorite: false })).json(); assert.equal(again.expiresAt, expiry);
  } finally { await f.close(); }
});

test('cross-account reads, writes, export and review are isolated; revoked invitations stop access immediately', async () => {
  const f = await setup();
  try {
    const id = (await f.call('POST', '/api/query', query())).json().entry.id;
    await f.call('PATCH', `/api/entries/${id}`, { favorite: true });
    for (const [method, path, payload] of [['GET', `/api/entries/${id}`], ['PATCH', `/api/entries/${id}`, { notes: 'attack' }], ['DELETE', `/api/entries/${id}`], ['POST', `/api/entries/${id}/review`, { review: 'learning' }]] as const) assert.equal((await f.call(method, path, payload, 'bob')).statusCode, 404);
    assert.deepEqual((await f.call('GET', '/api/export', undefined, 'bob')).json().entries, []);
    assert.equal((await f.call('GET', '/api/connection', undefined, 'bob')).json().connected, false);
    await f.admin('update private.invites set active=false where user_id=$1', [ALICE]);
    assert.equal((await f.call('GET', '/api/entries?kind=favorites')).statusCode, 401);
    assert.equal((await f.call('GET', '/api/entries/'+id)).statusCode, 401);
    assert.equal((await f.call('POST', '/api/logout')).statusCode, 200);
  } finally { await f.close(); }
});

test('expired records are invisible to lists, search, detail, updates and deletes; cleanup preserves favorites', async () => {
  const f = await setup();
  try {
    const old = (await f.call('POST', '/api/query', query('expired'))).json().entry.id;
    const kept = (await f.call('POST', '/api/query', query('favorite'))).json().entry.id;
    await f.call('PATCH', `/api/entries/${kept}`, { favorite: true });
    await f.admin('update private.entries set expires_at=clock_timestamp() where id=$1', [old]);
    assert.equal((await f.call('GET', '/api/entries?kind=history&search=expired')).json().entries.length, 0);
    for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await f.call(method, `/api/entries/${old}`, method === 'PATCH' ? { favorite: true } : undefined)).statusCode, 404);
    await f.admin('select private.cleanup()');
    assert.equal((await f.call('GET', `/api/entries/${kept}`)).statusCode, 200);
    assert.equal((await f.admin('select count(*)::int as total from private.entries')).rows[0].total, 1);
  } finally { await f.close(); }
});

test('English and Chinese literal search, cursor pagination, review priority and complete JSON export', async () => {
  const f = await setup();
  try {
    // Seed more than one page through SQL so model quota does not distort pagination tests.
    for (let i = 0; i < 33; i++) await f.admin("insert into private.entries(user_id,request_id,original,normalized,normalized_context,analysis,model,favorite,expires_at,favorited_at) values($1,$2,$3,$3,'',$4,'gemini-3.8-flash',true,null,clock_timestamp())", [ALICE, randomUUID(), `HELLO ${i}%`, JSON.stringify(analysis)]);
    const page1 = (await f.call('GET', '/api/entries?kind=favorites&search=hello')).json(); assert.equal(page1.entries.length, 30); assert.ok(page1.nextCursor);
    const page2 = (await f.call('GET', '/api/entries?kind=favorites&cursor='+page1.nextCursor)).json(); assert.equal(page2.entries.length, 3); assert.equal(new Set([...page1.entries, ...page2.entries].map(x => x.id)).size, 33);
    assert.equal((await f.call('GET', '/api/entries?kind=favorites&search='+encodeURIComponent('你好'))).json().entries.length, 30);
    assert.equal((await f.call('GET', '/api/entries?kind=favorites&search=%25')).json().entries.length, 30);
    assert.equal((await f.call('GET', '/api/entries?kind=favorites&search=_')).json().entries.length, 0);
    const id = page1.entries[0].id; await f.call('POST', `/api/entries/${id}/review`, { review: 'learning' });
    assert.equal((await f.call('GET', '/api/review')).json().entries[0].id, id);
    await f.call('POST', `/api/entries/${id}/review`, { review: 'remembered' });
    assert.notEqual((await f.call('GET', '/api/review')).json().entries[0].id, id);
    await f.call('PATCH', `/api/entries/${id}`, { source: 'fixture', notes: 'fixture note' });
    const output = (await f.call('GET', '/api/export')).json(); assert.equal(output.formatVersion, 1); assert.equal(output.entries.length, 33);
    const exported = output.entries.find((x: any) => x.id === id); assert.equal(exported.review, 'remembered'); assert.equal(exported.notes, 'fixture note'); assert.ok(exported.reviewedAt);
    for (const field of ['key','secret_id','user_id','request_id','session']) assert.ok(!JSON.stringify(output).includes('"'+field+'"'));
    assert.equal((await f.call('GET', '/api/entries?kind=favorites&cursor=invalid')).statusCode, 400);
    await f.call('DELETE', `/api/entries/${id}`); assert.equal((await f.call('GET', '/api/export')).json().entries.length, 32);
  } finally { await f.close(); }
});

test('invalid input and forged owners/secret IDs are rejected; writes require same origin', async () => {
  const f = await setup();
  try {
    for (const payload of [query('   '), query('a'.repeat(3001)), query('hi','a'.repeat(1001)), { ...query(), userId: BOB }, { ...query(), requestId: 'invalid' }]) assert.equal((await f.call('POST', '/api/query', payload)).statusCode, 400);
    assert.equal((await f.call('PUT', '/api/connection', { key: FAKE_KEY, model: 'gemini-3.8-flash', version: 1, secretId: randomUUID() })).statusCode, 400);
    const req = await f.app.inject({ method: 'POST', url: '/api/query', headers: { origin: 'https://attacker.example.invalid', cookie: '__Host-en-dic-session=alice-test-session' }, payload: query() }); assert.equal(req.statusCode, 403);
    assert.equal((await f.app.inject({ method: 'GET', url: '/api/me' })).statusCode, 401);
  } finally { await f.close(); }
});

test('refusal, invalid output, 429, timeout and storage failure never create successful history', async () => {
  for (const mode of ['refusal', 'format', 'quota', 'timeout', 'storage']) {
    const f = await setup(async () => {
      if (mode === 'refusal') throw new AppError(502, 'MODEL_FAILED', 'refused');
      if (mode === 'format') return { kind: 'word' } as Analysis;
      if (mode === 'quota') throw new AppError(429, 'MODEL_QUOTA', 'quota');
      if (mode === 'timeout') return new Promise(() => {});
      return analysis;
    }, 30);
    try {
      if (mode === 'storage') { await f.admin("create function private.fail_save() returns trigger language plpgsql as $$ begin raise exception 'fixture save failure'; end $$;"); await f.admin("create trigger fail_save before insert on private.entries for each row execute function private.fail_save();"); }
      const result = await f.call('POST', '/api/query', query()); assert.ok(result.statusCode >= 400, mode);
      assert.equal((await f.admin('select count(*)::int as total from private.entries')).rows[0].total, 0);
      assert.equal((await f.admin('select count(*)::int as total from private.requests')).rows[0].total, 0);
      assert.equal((await f.admin('select count(*)::int as total from private.leases')).rows[0].total, 0);
    } finally { await f.close(); }
  }
});

test('parallel retry cannot release the original reservation; disconnect cancels in-flight query', async () => {
  let started!: () => void, finish!: (value: Analysis) => void;
  let ready = new Promise<void>(resolve => { started = resolve; });
  const f = await setup(async () => { started(); return new Promise<Analysis>(resolve => { finish = resolve; }); });
  try {
    const input = query(); const pending = f.call('POST', '/api/query', input); await ready;
    assert.equal((await f.call('POST', '/api/query', input)).statusCode, 409);
    assert.equal((await f.admin('select count(*)::int as total from private.leases')).rows[0].total, 1);
    finish(analysis); assert.equal((await pending).statusCode, 200);
    ready = new Promise(resolve => { started = resolve; }); const next = f.call('POST', '/api/query', query('second')); await ready;
    assert.equal((await f.call('DELETE', '/api/connection')).json().connected, false);
    assert.equal((await next).statusCode, 409); finish(analysis);
    assert.equal((await f.call('GET', '/api/entries?kind=history')).json().entries.length, 1);
    assert.equal((await f.admin('select count(*)::int as total from vault.secrets')).rows[0].total, 0);
  } finally { await f.close(); }
});

test('settings test before saving; disconnected account fences concurrent first connection', async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const f = await setup(async () => { started(); return new Promise<Analysis>(() => {}); });
  try {
    const pending = f.call('PUT', '/api/connection', { key: FAKE_KEY, model: 'gemini-3.8-flash', version: 0 }, 'bob'); await ready;
    const disconnected = await f.call('DELETE', '/api/connection', undefined, 'bob'); assert.equal(disconnected.statusCode, 200);
    assert.equal((await pending).statusCode, 409);
    assert.equal((await f.call('GET', '/api/connection', undefined, 'bob')).json().connected, false);
  } finally { await f.close(); }
});

test('OAuth cookies are HttpOnly/Secure, PKCE flows are single-use, independent, and expire; sessions are hashed', async () => {
  const f = await setup();
  try {
    const starts = await Promise.all([f.app.inject('/auth/google'), f.app.inject('/auth/google')]);
    const cookies = starts.map(x => String(x.headers['set-cookie'])); assert.notEqual(cookies[0], cookies[1]);
    for (const c of cookies) { assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/); assert.match(c, /Max-Age=600/); }
    const callback = (start: typeof starts[0], c: string, code: string) => {
      const target = new URL(start.headers.location!); const url = new URL(target.searchParams.get('redirect')!); url.searchParams.set('code', code);
      return f.app.inject({ url: url.pathname+url.search, headers: { cookie: c.split(';')[0] } });
    };
    const completed = await callback(starts[0], cookies[0], 'alice'); assert.equal(completed.headers.location, '/'); assert.match(String(completed.headers['set-cookie']), /Max-Age=604800/);
    assert.equal((await callback(starts[0], cookies[0], 'alice')).headers.location, '/?login=failed');
    await f.admin("update private.login_flows set expires_at=clock_timestamp()-interval '1 second'");
    assert.equal((await callback(starts[1], cookies[1], 'alice')).headers.location, '/?login=failed');
    const hashes = (await f.admin('select hash from private.sessions')).rows; assert.ok(hashes.every(x => /^[a-f0-9]{64}$/.test(x.hash)));
    await f.admin('update private.invites set active=false where user_id=$1', [BOB]); const start = await f.app.inject('/auth/google');
    assert.equal((await callback(start, String(start.headers['set-cookie']), 'bob')).headers.location, '/?login=invite');
  } finally { await f.close(); }
});
