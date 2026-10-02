import Fastify, { type FastifyRequest, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { AnalysisSchema, QuerySchema, UpdateSchema, DEFAULT_MODEL, normalize, type QueryInput, type Connection } from '@en-dic/shared';
import type { Database, Sql } from './db.js';
import type { AuthProvider } from './auth.js';
import { hash, token } from './auth.js';
import { AppError, missing, unauthorized } from './errors.js';
import { entry, detail, list } from './entries.js';
import { VaultCredentialStore, suppliedCredential, type Analyzer } from './model.js';
export interface AppOptions { db: Database; auth: AuthProvider; analyzer: Analyzer; origin: string; staticRoot?: string; timeoutMs?: number; }
export async function buildApp(options: AppOptions) {
  const { db, auth, analyzer, origin } = options;
  const app = Fastify({ logger: false, bodyLimit: 32000, ajv: { customOptions: { removeAdditional: false } } });
  await app.register(cookie);
  const secure = origin.startsWith('https:');
  const sessionName = secure ? '__Host-en-dic-session' : 'en-dic-session';
  const flowName = (id: string) => `${secure ? '__Host-' : ''}en-dic-flow-${id}`;
  const cookieOptions = { path: '/', httpOnly: true, secure, sameSite: 'lax' as const };
  const active = new Map<string, Set<AbortController>>();
  function session(request: FastifyRequest) {
    const value = request.cookies[sessionName]; if (!value) throw unauthorized(); return hash(value);
  }
  const status = async (sql: Sql): Promise<Connection> => {
    const row = (await sql.query('select * from private.connection_status()')).rows[0];
    return row ? { connected: row.connected, model: row.model, version: row.version, testedAt: row.tested_at ? new Date(row.tested_at).toISOString() : null, status: row.status } : { connected: false, model: DEFAULT_MODEL, version: 0, testedAt: null, status: 'disconnected' };
  };
  const user = <T>(req: FastifyRequest, fn: (sql: Sql, id: string) => Promise<T>) => db.user(session(req), fn);
  const uuidParams = Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
  const identity = async (req: FastifyRequest) => user(req, async (_sql, id) => id);
  const cancel = (id: string) => { for (const controller of active.get(id) ?? []) controller.abort(new AppError(409, 'CONNECTION_CHANGED', '連線已更換或解除，請重新查詢。')); };
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) throw new AppError(403, 'INVALID_ORIGIN', '請從本站操作。');
    if (req.url.startsWith('/api/') && req.url !== '/api/health' && req.url !== '/api/logout') await identity(req);
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    const failure = error as FastifyError;
    if (failure.validation || failure.statusCode === 400 || failure.statusCode === 413) return reply.code(failure.statusCode === 413 ? 413 : 400).send({ error: { code: 'INVALID_INPUT', message: '輸入格式或長度不符合要求。' } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服務暫時無法完成操作，請稍後重試。' } });
  });
  app.get('/api/health', async () => ({ status: 'ready' }));
  app.get('/auth/google', async (_req, reply) => {
    const flow = token(), secret = token(), verifier = token();
    await db.system(sql => sql.query('select private.begin_login($1,$2)', [hash(secret), verifier]));
    reply.setCookie(flowName(flow), secret, { ...cookieOptions, maxAge: 600 });
    return reply.redirect(auth.authorize(verifier, `${origin}/auth/callback?flow=${flow}`));
  });
  app.get<{ Querystring: { flow: string; code?: string; error?: string } }>('/auth/callback', {
    schema: { querystring: Type.Object({ flow: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }), code: Type.Optional(Type.String({ maxLength: 4096 })), error: Type.Optional(Type.String({ maxLength: 300 })), error_description: Type.Optional(Type.String({ maxLength: 1000 })) }, { additionalProperties: false }) },
  }, async (req, reply) => {
    const name = flowName(req.query.flow), secret = req.cookies[name]; reply.clearCookie(name, cookieOptions);
    if (!secret) return reply.redirect('/?login=expired');
    const rows = await db.system(async sql => (await sql.query('select * from private.consume_login($1)', [hash(secret)])).rows);
    if (!rows[0] || !req.query.code || req.query.error) return reply.redirect('/?login=failed');
    try {
      const person = await auth.exchange(req.query.code, rows[0].verifier), sessionToken = token();
      const allowed = await db.system(async sql => (await sql.query('select private.create_session($1,$2,$3) as allowed', [person.id, person.email, hash(sessionToken)])).rows[0].allowed);
      if (!allowed) return reply.redirect('/?login=invite');
      reply.setCookie(sessionName, sessionToken, { ...cookieOptions, maxAge: 7 * 86400 });
      return reply.redirect('/');
    } catch { return reply.redirect('/?login=failed'); }
  });
  app.get('/api/me', async req => user(req, async () => ({ signedIn: true })));
  app.post('/api/logout', async (req, reply) => {
    const value = req.cookies[sessionName];
    if (value) {
      try { cancel(await identity(req)); } catch { /* expired/revoked sessions can still log out */ }
      await db.system(sql => sql.query('select private.logout($1)', [hash(value)]));
    }
    reply.clearCookie(sessionName, cookieOptions); return { signedIn: false };
  });
  app.get('/api/connection', async req => user(req, status));
  app.get('/api/models', async () => ({ models: analyzer.models(), defaultModel: DEFAULT_MODEL }));
  async function runModel<T>(req: FastifyRequest, requestId: string, connection: Connection, credentials: ReturnType<typeof suppliedCredential>, original: string, context: string, finish: (analysis: import('@en-dic/shared').Analysis) => Promise<T>, replay?: () => Promise<T | undefined>) {
    const sessionHash = session(req), id = await identity(req), controller = new AbortController();
    const code = await user(req, async sql => (await sql.query('select private.reserve_query($1) as result', [requestId])).rows[0].result);
    if (code !== 'ok') {
      if (code === 'unauthorized') throw unauthorized();
      // A save can commit while its owner still holds the lease. Replaying here
      // must not release that lease because this invocation never acquired it.
      const saved = await replay?.();
      if (saved !== undefined) return saved;
      throw new AppError(code === 'busy' ? 409 : 429, code === 'busy' ? 'QUERY_BUSY' : 'QUERY_LIMIT', code === 'busy' ? '已有解析進行中，請稍候再試。' : '已達每分鐘 10 次或每日 100 次查詢限制。');
    }
    const set = active.get(id) ?? new Set<AbortController>(); set.add(controller); active.set(id, set);
    const timeout = setTimeout(() => controller.abort(new AppError(504, 'MODEL_TIMEOUT', '解析超過 60 秒，請手動重試。')), options.timeoutMs ?? 60000);
    let checking = false;
    const monitor = setInterval(async () => {
      if (checking) return; checking = true;
      try { const current = await db.user(sessionHash, status); if (current.version !== connection.version) controller.abort(new AppError(409, 'CONNECTION_CHANGED', '連線已變更，請重新查詢。')); }
      catch { controller.abort(unauthorized()); } finally { checking = false; }
    }, 500);
    try {
      // The initial lookup may predate another invocation's completed save.
      // Recheck only after acquiring the lease, before invoking the model.
      const saved = await replay?.();
      if (saved !== undefined) return saved;
      const result = await Promise.race([
        analyzer.analyze({ original, context, model: connection.model, credentials, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
      ]);
      if (!Value.Check(AnalysisSchema, result)) throw new AppError(502, 'INVALID_ANALYSIS', '解析格式不正確，請手動重試。');
      controller.signal.throwIfAborted();
      return await finish(result);
    } finally {
      clearTimeout(timeout); clearInterval(monitor); set.delete(controller); if (!set.size) active.delete(id);
      await release(req, requestId);
    }
  }
  const release = async (req: FastifyRequest, id: string) => { try { await user(req, sql => sql.query('select private.release_query($1)', [id])); } catch { /* leases expire in <=60s */ } };
  app.put<{ Body: { key?: string; model: string; version: number } }>('/api/connection', {
    schema: { body: Type.Object({ key: Type.Optional(Type.String({ minLength: 10, maxLength: 300 })), model: Type.String({ minLength: 1, maxLength: 100 }), version: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }) },
  }, async req => {
    if (!analyzer.models().includes(req.body.model)) throw new AppError(400, 'MODEL_UNAVAILABLE', '此模型不支援。');
    const current = await user(req, status);
    if (current.version !== req.body.version) throw new AppError(409, 'CONNECTION_CHANGED', '設定已變更，請重新載入。');
    const selected = { ...current, model: req.body.model }, requestId = randomUUID();
    const credentials = req.body.key ? suppliedCredential(req.body.key) : new VaultCredentialStore(db, session(req), current.version);
    try {
      return await runModel(req, requestId, selected, credentials, 'hello', 'A greeting.', async () => {
      const saved = await user(req, async sql => (await sql.query('select private.save_connection($1,$2,$3) as saved', [req.body.key ?? null, req.body.model, current.version])).rows[0].saved);
      if (!saved) throw new AppError(409, 'CONNECTION_CHANGED', '連線已變更，請重新載入設定。');
      cancel(await identity(req)); return await user(req, status);
      });
    } finally { /* reservation is released only by its owner in runModel */ }
  });
  app.post('/api/connection/test', async req => {
    const current = await user(req, status), requestId = randomUUID();
    try {
      return await runModel(req, requestId, current, new VaultCredentialStore(db, session(req), current.version), 'hello', 'A greeting.', async () => {
      const saved = await user(req, async sql => (await sql.query('select private.save_connection(null,$1,$2) as saved', [current.model, current.version])).rows[0].saved);
      if (!saved) throw new AppError(409, 'CONNECTION_CHANGED', '連線已變更。');
      return user(req, status);
      });
    } catch (error) { if (error instanceof AppError && ['MODEL_AUTH', 'MODEL_UNAVAILABLE'].includes(error.code)) await user(req, sql => sql.query('select private.connection_error($1)', [current.version])); throw error; }
    finally { /* runModel owns the lease */ }
  });
  app.delete('/api/connection', async req => {
    const id = await identity(req); await user(req, sql => sql.query('select private.disconnect()')); cancel(id); return user(req, status);
  });
  app.post<{ Body: QueryInput }>('/api/query', { schema: { body: QuerySchema } }, async req => {
    const { original, requestId } = req.body, context = req.body.context ?? '';
    if (!original.trim()) throw new AppError(400, 'INVALID_INPUT', '請貼上英文內容。');
    const fingerprint = hash(JSON.stringify([original, context]));
    const favorites = (sql: Sql) => sql.query('select id from private.entries where favorite and normalized=$1 and normalized_context=$2 order by favorited_at desc,id desc', [normalize(original), normalize(context)]);
    const replay = () => user(req, async sql => {
      const previous = (await sql.query('select * from private.request_status($1)', [requestId])).rows[0];
      if (!previous) return undefined;
      if (previous.fingerprint !== fingerprint) throw new AppError(409, 'REQUEST_CONFLICT', '此請求識別已用於其他內容。');
      return { entry: await detail(sql, previous.entry_id), existingFavorites: (await favorites(sql)).rows.map(x => x.id) };
    });
    const previous = await replay();
    if (previous !== undefined) return previous;
    const connection = await user(req, status);
    if (!connection.connected) throw new AppError(409, 'CONNECTION_REQUIRED', '請先在設定連接 Gemini Key。');
    try {
      return await runModel(req, requestId, connection, new VaultCredentialStore(db, session(req), connection.version), original, context, analysis => user(req, async (sql, id) => {
        const valid = (await sql.query('select private.lock_connection($1) as valid', [connection.version])).rows[0].valid;
        if (!valid) throw new AppError(409, 'CONNECTION_CHANGED', '連線已變更，解析未保存。');
        const { rows } = await sql.query('insert into private.entries(user_id,request_id,original,context,normalized,normalized_context,analysis,model) values($1,$2,$3,$4,$5,$6,$7,$8) returning *', [id, requestId, original, context, normalize(original), normalize(context), JSON.stringify(analysis), connection.model]);
        await sql.query('select private.complete_request($1,$2,$3)', [requestId, fingerprint, rows[0].id]);
        return { entry: entry(rows[0]), existingFavorites: (await favorites(sql)).rows.map(x => x.id) };
      }), replay);
    } catch (error) { if (error instanceof AppError && ['MODEL_AUTH', 'MODEL_UNAVAILABLE'].includes(error.code)) await user(req, sql => sql.query('select private.connection_error($1)', [connection.version])); throw error; }
    finally { /* runModel owns the lease */ }
  });
  app.get<{ Querystring: { kind: 'favorites' | 'history'; search?: string; cursor?: string } }>('/api/entries', {
    schema: { querystring: Type.Object({ kind: Type.Union([Type.Literal('favorites'), Type.Literal('history')]), search: Type.Optional(Type.String({ maxLength: 300 })), cursor: Type.Optional(Type.String({ maxLength: 256 })) }, { additionalProperties: false }) },
  }, async req => user(req, sql => list(sql, req.query.kind, req.query.search, req.query.cursor)));
  app.get<{ Params: { id: string } }>('/api/entries/:id', { schema: { params: uuidParams } }, async req => user(req, sql => detail(sql, req.params.id)));
  app.patch<{ Params: { id: string }; Body: { favorite?: boolean; source?: string; notes?: string } }>('/api/entries/:id', { schema: { params: uuidParams, body: UpdateSchema } }, async req => user(req, async sql => {
    const { favorite, source, notes } = req.body;
    const { rows } = await sql.query(`update private.entries set
      favorited_at=case when $2::boolean=true and not favorite then clock_timestamp() when $2::boolean=false then null else favorited_at end,
      expires_at=case when $2::boolean=true then null when $2::boolean=false and favorite then clock_timestamp()+interval '336 hours' else expires_at end,
      favorite=coalesce($2,favorite),source=coalesce($3,source),notes=coalesce($4,notes) where id=$1 returning *`, [req.params.id, favorite ?? null, source ?? null, notes ?? null]);
    if (!rows[0]) throw missing(); return entry(rows[0]);
  }));
  app.delete<{ Params: { id: string } }>('/api/entries/:id', { schema: { params: uuidParams } }, async req => user(req, async sql => {
    const rows = (await sql.query('delete from private.entries where id=$1 returning id', [req.params.id])).rows; if (!rows[0]) throw missing(); return { deleted: true };
  }));
  app.get('/api/review', async req => user(req, async sql => ({ entries: (await sql.query("select * from private.entries where favorite order by case review when 'learning' then 0 when 'remembered' then 2 else 1 end, reviewed_at asc nulls first, favorited_at asc,id asc limit 30")).rows.map(entry) })));
  app.post<{ Params: { id: string }; Body: { review: 'remembered' | 'learning' } }>('/api/entries/:id/review', { schema: { params: uuidParams, body: Type.Object({ review: Type.Union([Type.Literal('remembered'), Type.Literal('learning')]) }, { additionalProperties: false }) } }, async req => user(req, async sql => {
    const { rows } = await sql.query('update private.entries set review=$2,reviewed_at=clock_timestamp() where id=$1 and favorite returning *', [req.params.id, req.body.review]); if (!rows[0]) throw missing(); return entry(rows[0]);
  }));
  app.get('/api/export', async (req, reply) => {
    const entries = await user(req, async sql => (await sql.query('select * from private.entries where favorite order by favorited_at desc,id desc')).rows.map(entry));
    reply.header('Content-Disposition', 'attachment; filename="english-collection.json"');
    return { formatVersion: 1, exportedAt: new Date().toISOString(), entries };
  });
  if (options.staticRoot) {
    await app.register(staticFiles, { root: resolve(options.staticRoot), wildcard: false });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') || req.url.startsWith('/auth/') || req.url.includes('.') ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到頁面。' } }) : reply.sendFile('index.html'));
  }
  app.addHook('onClose', async () => { for (const id of active.keys()) cancel(id); });
  return app;
}
