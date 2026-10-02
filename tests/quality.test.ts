import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualityCases, runQuality, reportChecksum, scoreQuality, type ScoreSheet } from '../scripts/quality.js';
import { DEFAULT_MODEL, type Analysis } from '@en-dic/shared';

const cases = qualityCases();
const response = (kind: Analysis['kind']): Analysis => kind === 'word' ? { kind, translation: '測試翻譯', ambiguity: '', partOfSpeech: '測試', usage: '測試用法', meanings: ['測試'] } : kind === 'phrase' ? { kind, translation: '測試翻譯', ambiguity: '', usage: '測試用法', example: 'An example.' } : { kind, translation: '測試翻譯', ambiguity: '', structure: '測試結構', vocabulary: [] };
test('40-case harness preserves inputs, tracks failures and never exposes provider error text', async () => {
  let index = 0;
  const report = await runQuality({ models: () => [DEFAULT_MODEL], analyze: async input => {
    const item = cases[index++]; assert.equal(input.original, item.original); assert.equal(input.context, item.context);
    assert.equal((await input.credentials.read('google'))?.type, 'api_key');
    if (item.id === 'Q01') throw new Error('fixture-sensitive-marker');
    if (item.id === 'Q02') return { kind: 'word' } as Analysis;
    return response(item.expectedKind);
  } }, DEFAULT_MODEL, 'synthetic-test-credential', 'fixture');
  assert.equal(index, 40); assert.equal(report.results[0].errorCode, 'MODEL_FAILED'); assert.equal(report.results[1].errorCode, 'INVALID_ANALYSIS');
  assert.ok(!JSON.stringify(report).includes('fixture-sensitive-marker'));
  assert.ok(!JSON.stringify(report).includes('synthetic-test-credential'));
  const sheet: ScoreSheet = { evaluator: 'fixture-reviewer', reportChecksum: reportChecksum(report), scores: cases.map(x => ({ id: x.id, translation: true, context: true, explanation: true, traditionalChinese: true, notes: '' })) };
  const summary = scoreQuality(report, sheet); assert.equal(summary.passed, 38); assert.equal(summary.accepted, false, 'fixture results must not pass real-model acceptance');
  const real = { ...report, source: 'real-model' as const }; sheet.reportChecksum = reportChecksum(real);
  assert.equal(scoreQuality(real, sheet).accepted, true, 'tests exercise the threshold, not live acceptance');
  sheet.scores[2].translation = false; sheet.scores[3].explanation = false;
  assert.equal(scoreQuality(real, sheet).passed, 36); sheet.scores[4].context = false; assert.equal(scoreQuality(real, sheet).accepted, false);
  sheet.scores[5].translation = null; assert.throws(() => scoreQuality(real, sheet), /explicit human/);
  sheet.scores[5].translation = true; sheet.reportChecksum = null; assert.throws(() => scoreQuality(real, sheet), /checksum/);
  sheet.reportChecksum = reportChecksum(real); sheet.scores[0].id = 'Q02'; assert.throws(() => scoreQuality(real, sheet), /40 cases/);
});
