import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { externalPath, externalJson, loadConfig, projectRoot } from '../apps/server/src/config.js';
import { decodeCursor } from '../apps/server/src/entries.js';

const directory = mkdtempSync(join(tmpdir(), 'en-dic-config-'));
const config = { origin: 'https://dictionary.example.invalid', databaseUrl: 'postgresql://fixture@localhost/fixture', supabaseUrl: 'https://auth.example.invalid', supabasePublishableKey: 'synthetic-publishable-value', port: 3000 };

test('configuration rejects lexical and physical project paths, including symlink ancestors', () => {
  const ownLink = join(directory, 'project'); symlinkSync(projectRoot, ownLink);
  assert.throws(() => externalPath(join(ownLink, 'package.json')), /outside/);
  assert.throws(() => externalPath(join(projectRoot, 'package.json')), /outside/);
  assert.throws(() => externalPath(join(ownLink, 'new-report.json'), false), /outside/);
  assert.throws(() => externalPath('relative.json'), /absolute/);
  const file = join(directory, 'config.json'); writeFileSync(file, JSON.stringify(config));
  const link = join(directory, 'external.json'); symlinkSync(file, link);
  assert.equal(externalPath(link), file);
  assert.deepEqual(externalJson(link), config);
  // A project-local symlink is rejected even when its target is external.
  const inProject = join(projectRoot, 'node_modules', `en-dic-config-fixture-link-${randomUUID()}`);
  symlinkSync(file, inProject); assert.throws(() => externalPath(inProject), /outside/);
});

test('malformed configuration never leaks input, URL credentials or filesystem errors', () => {
  const before = process.env.EN_DIC_CONFIG, port = process.env.PORT;
  delete process.env.PORT;
  try {
    const file = join(directory, 'invalid.json'); process.env.EN_DIC_CONFIG = file;
    for (const value of ['{"fixture-sensitive-marker":', JSON.stringify({ ...config, origin: 'not-a-url-fixture-sensitive-marker' }), JSON.stringify({ ...config, origin: 'ftp://localhost' }), JSON.stringify({ ...config, port: 65536 }), JSON.stringify({ ...config, supabaseUrl: 'https://fixture-sensitive-marker@auth.example.invalid' })]) {
      writeFileSync(file, value);
      assert.throws(loadConfig, error => error instanceof Error && !error.message.includes('fixture-sensitive-marker') && !error.message.includes(file));
    }
    writeFileSync(file, JSON.stringify(config)); assert.deepEqual(loadConfig(), config);
    process.env.EN_DIC_CONFIG = join(directory, 'missing.json'); assert.throws(loadConfig, /Cannot read external/);
  } finally {
    if (before === undefined) delete process.env.EN_DIC_CONFIG; else process.env.EN_DIC_CONFIG = before;
    if (port === undefined) delete process.env.PORT; else process.env.PORT = port;
  }
});

test('cursor validates complete UUID structure and canonical timestamps before SQL', () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const valid = { at: '2026-10-02T07:00:00.000Z', id: '00000000-0000-4000-8000-000000000001' };
  assert.deepEqual(decodeCursor(encode(valid)), valid);
  for (const value of [null, {}, { ...valid, id: '-'.repeat(36) }, { ...valid, id: 'a'.repeat(36) }, { ...valid, id: 123 }, { ...valid, at: '2026-02-30T07:00:00.000Z' }, { ...valid, at: '2026-10-02' }]) assert.throws(() => decodeCursor(encode(value)), /分頁位置無效/);
  assert.throws(() => decodeCursor('a'.repeat(257)), /分頁位置無效/);
});
