import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { piAnalyzer, suppliedCredential, noAmbientAuth } from '../apps/server/src/model.js';
import { AppError } from '../apps/server/src/errors.js';
import { DEFAULT_MODEL, type Analysis } from '@en-dic/shared';
import { FAKE_KEY } from './database.js';

const word: Analysis = { kind: 'word', translation: '你好', ambiguity: '', partOfSpeech: '感嘆詞', usage: '打招呼', meanings: ['你好'] };
const phrase: Analysis = { kind: 'phrase', translation: '放棄', ambiguity: '', usage: '停止嘗試', example: 'Do not give up.' };
const sentence: Analysis = { kind: 'sentence', translation: '我喜歡閱讀。', ambiguity: '', structure: '主詞＋動詞＋受詞', vocabulary: [{ english: 'reading', meaning: '閱讀' }] };
const wire = (analysis: any) => ({ partOfSpeech: '', usage: '', meanings: [], example: '', structure: '', vocabulary: [], ...analysis });
const candidate = (args: any = { analysis: word }, finishReason = 'STOP', name = 'return_analysis') => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args: { ...args, analysis: wire(args.analysis) } } }] }, finishReason }] });
function stream(chunks: unknown[]) {
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function transport(t: TestContext, replies: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>) {
  const requests: { url: string; headers: Headers; body: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    const reply = replies.shift();
    assert.ok(reply, 'unexpected transport call (SDK retry or credential/model fallback)');
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(init) : reply;
  });
  const analyzer = piAnalyzer();
  const analyze = (overrides: Partial<Parameters<typeof analyzer.analyze>[0]> = {}) => analyzer.analyze({ original: 'hello', context: 'A greeting.', model: DEFAULT_MODEL, credentials: suppliedCredential(FAKE_KEY), signal: new AbortController().signal, ...overrides });
  return { requests, analyzer, analyze };
}
const failure = (code: string, status?: number) => (error: unknown) => {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, code);
  if (status !== undefined) assert.equal(error.status, status);
  assert.ok(!error.message.includes('provider-private-body'));
  assert.ok(!error.message.includes(FAKE_KEY));
  return true;
};
const httpError = (status: number) => new Response(JSON.stringify({ error: { code: status, message: `provider-private-body ${FAKE_KEY}` } }), { status, headers: { 'content-type': 'application/json' } });

test('actual Pi Google adapter transport and strict analysis contract', async t => {
  for (const analysis of [word, phrase, sentence]) await t.test(`${analysis.kind}: strict tool schema, selected model, explicit key and limits`, async t => {
    const f = transport(t, [stream([candidate({ analysis })])]);
    assert.deepEqual(await f.analyze(), analysis);
    assert.equal(f.requests.length, 1);
    const req = f.requests[0];
    assert.equal(req.url, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:streamGenerateContent?alt=sse`);
    assert.equal(req.headers.get('x-goog-api-key'), FAKE_KEY);
    assert.equal(req.body.generationConfig.maxOutputTokens, 4096);
    assert.equal(req.body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
    assert.equal(req.body.toolConfig.functionCallingConfig.mode, 'ANY');
    const tool = req.body.tools[0].functionDeclarations[0];
    assert.equal(tool.name, 'return_analysis');
    assert.equal(tool.parametersJsonSchema.additionalProperties, false);
    assert.deepEqual(tool.parametersJsonSchema.required, ['analysis']);
    assert.equal(tool.parametersJsonSchema.properties.analysis.additionalProperties, false);
    assert.equal(tool.parametersJsonSchema.properties.analysis.anyOf, undefined);
    assert.equal(tool.parametersJsonSchema.properties.analysis.required.length, 9);
    assert.deepEqual(JSON.parse(req.body.contents[0].parts[0].text), { original: 'hello', context: 'A greeting.' });
  });

  for (const status of [500, 502, 503, 599]) await t.test(`${status}: only one retry, same model and key`, async t => {
    const f = transport(t, [httpError(status), stream([candidate()])]);
    assert.deepEqual(await f.analyze(), word);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].url, f.requests[1].url);
    assert.equal(f.requests[1].headers.get('x-goog-api-key'), FAKE_KEY);
  });
  await t.test('persistent 5xx stops after two transport calls', async t => {
    const f = transport(t, [httpError(503), httpError(503)]);
    await assert.rejects(f.analyze(), failure('MODEL_FAILED', 502));
    assert.equal(f.requests.length, 2);
  });
  for (const [status, code, publicStatus] of [[429, 'MODEL_QUOTA', 429], [400, 'MODEL_AUTH', 422], [401, 'MODEL_AUTH', 422], [403, 'MODEL_AUTH', 422], [404, 'MODEL_UNAVAILABLE', 422], [408, 'MODEL_FAILED', 502], [409, 'MODEL_FAILED', 502]] as const) await t.test(`${status}: classified without retry or fallback`, async t => {
    const f = transport(t, [httpError(status)]);
    await assert.rejects(f.analyze(), failure(code, publicStatus));
    assert.equal(f.requests.length, 1);
  });
  await t.test('a 5xx followed by 429 does not trigger a third attempt', async t => {
    const f = transport(t, [httpError(503), httpError(429)]);
    await assert.rejects(f.analyze(), failure('MODEL_QUOTA'));
    assert.equal(f.requests.length, 2);
  });
  for (const [label, chunks] of [
    ['text instead of tool', [{ candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }] }]],
    ['truncated', [candidate({ analysis: word }, 'MAX_TOKENS')]],
    ['missing field', [candidate({ analysis: { ...word, meanings: undefined } })]],
    ['extra field', [candidate({ analysis: { ...word, credential: 'provider-private-body' } })]],
    ['extra envelope field', [candidate({ analysis: word, other: true })]],
    ['blank translation', [candidate({ analysis: { ...word, translation: ' ' } })]],
    ['unknown kind', [candidate({ analysis: { ...word, kind: 'paragraph' } })]],
    ['nonempty unused field', [candidate({ analysis: { ...word, example: 'must not be silently dropped' } })]],
    ['wrong tool', [candidate({ analysis: word }, 'STOP', 'other_tool')]],
    ['two calls', [{ candidates: [{ content: { parts: [{ functionCall: { name: 'return_analysis', args: { analysis: word } } }, { functionCall: { name: 'return_analysis', args: { analysis: word } } }] }, finishReason: 'STOP' }] }]],
  ] as const) await t.test(`${label}: rejected without retry`, async t => {
    const f = transport(t, [stream([...chunks])]);
    await assert.rejects(f.analyze(), failure('INVALID_ANALYSIS'));
    assert.equal(f.requests.length, 1);
  });
  for (const reason of ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT']) await t.test(`refusal ${reason}: rejected without retry`, async t => {
    const f = transport(t, [stream([{ candidates: [{ finishReason: reason }] }])]);
    await assert.rejects(f.analyze(), (error: unknown) => error instanceof AppError && ['MODEL_FAILED', 'INVALID_ANALYSIS'].includes(error.code));
    assert.equal(f.requests.length, 1);
  });
  for (const [label, reply] of [['network error', new TypeError('provider-private-body')], ['malformed SSE', new Response('data: not-json\n\n', { headers: { 'content-type': 'text/event-stream' } })], ['unfinished stream', stream([ { candidates: [{ content: { parts: [{ text: 'partial' }] } }] } ])]] as const) await t.test(`${label}: no automatic retry`, async t => {
    const f = transport(t, [reply]);
    await assert.rejects(f.analyze(), failure('MODEL_FAILED'));
    assert.equal(f.requests.length, 1);
  });
  await t.test('missing credentials and unsupported model never use ambient authentication or fallback', async t => {
    const f = transport(t, []);
    await assert.rejects(f.analyze({ credentials: { ...suppliedCredential(FAKE_KEY), read: async () => undefined } }), failure('CONNECTION_REQUIRED'));
    for (const model of ['gemini-2.5-flash', 'unknown-model']) await assert.rejects(f.analyze({ model }), failure('MODEL_UNAVAILABLE'));
    assert.equal(await noAmbientAuth.env(), undefined);
    assert.equal(await noAmbientAuth.fileExists(), false);
    assert.equal(f.requests.length, 0);
  });
  await t.test('abort before transmission makes no request', async t => {
    const f = transport(t, []), controller = new AbortController();
    const reason = new AppError(504, 'MODEL_TIMEOUT', 'fixture timeout'); controller.abort(reason);
    await assert.rejects(f.analyze({ signal: controller.signal }), error => error === reason);
    assert.equal(f.requests.length, 0);
  });
  await t.test('abort during transport cancels SDK request without retry', async t => {
    const controller = new AbortController();
    const reason = new AppError(504, 'MODEL_TIMEOUT', 'fixture timeout');
    const f = transport(t, [async init => {
      assert.ok(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        controller.abort(reason);
      });
    }]);
    await assert.rejects(f.analyze({ signal: controller.signal }), error => error === reason);
    assert.equal(f.requests.length, 1);
  });
});
