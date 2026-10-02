import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Value } from 'typebox/value';
import { AnalysisSchema, DEFAULT_MODEL, type Analysis } from '@en-dic/shared';
import { piAnalyzer, suppliedCredential, type Analyzer } from '../apps/server/src/model.js';
import { AppError } from '../apps/server/src/errors.js';
import { externalJson, externalPath, projectRoot } from '../apps/server/src/config.js';

export interface QualityCase { id: string; category: 'word' | 'phrase' | 'polysemy' | 'ellipsis' | 'paragraph'; original: string; context: string; expectedKind: Analysis['kind']; criteria: string; }
export const dimensions = ['translation', 'context', 'explanation', 'traditionalChinese'] as const;
export function qualityCases(): QualityCase[] {
  const cases = JSON.parse(readFileSync(resolve(projectRoot, 'tests/fixtures/quality-cases.json'), 'utf8')) as QualityCase[];
  if (cases.length !== 40 || new Set(cases.map(x => x.id)).size !== 40 || cases.some(x => !/^Q\d{2}$/.test(x.id) || !x.original?.trim() || x.original.length > 3000 || typeof x.context !== 'string' || x.context.length > 1000 || !x.criteria?.trim() || !['word','phrase','sentence'].includes(x.expectedKind))) throw new Error('Invalid quality case set');
  for (const category of ['word','phrase','polysemy','ellipsis','paragraph']) if (cases.filter(x => x.category === category).length !== 8) throw new Error('Each category requires eight cases');
  return cases;
}
const digest = (cases: QualityCase[]) => createHash('sha256').update(JSON.stringify(cases)).digest('hex');
export interface QualityResult { id: string; durationMs: number; analysis: Analysis | null; errorCode: string | null; }
export interface QualityReport { formatVersion: 1; source: 'real-model' | 'fixture'; provider: 'google'; model: string; caseChecksum: string; startedAt: string; results: QualityResult[]; }
export async function runQuality(analyzer: Analyzer, model: string, key: string, source: QualityReport['source']): Promise<QualityReport> {
  const cases = qualityCases();
  if (!analyzer.models().includes(model)) throw new Error('Unsupported quality model');
  const results: QualityResult[] = [], startedAt = new Date().toISOString();
  for (const item of cases) {
    const controller = new AbortController(), start = performance.now();
    const timeout = setTimeout(() => controller.abort(new AppError(504, 'MODEL_TIMEOUT', 'Timed out')), 60000);
    try {
      const analysis = await Promise.race([analyzer.analyze({ original: item.original, context: item.context, model, credentials: suppliedCredential(key), signal: controller.signal }), new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))]);
      if (!Value.Check(AnalysisSchema, analysis)) throw new AppError(502, 'INVALID_ANALYSIS', 'Invalid analysis');
      results.push({ id: item.id, durationMs: Math.round(performance.now() - start), analysis, errorCode: null });
    } catch (error) {
      // No provider error text, key or stack is written to the report or logs.
      const allowed = ['MODEL_TIMEOUT','INVALID_ANALYSIS','MODEL_AUTH','MODEL_UNAVAILABLE','MODEL_QUOTA','MODEL_FAILED','CONNECTION_REQUIRED'];
      results.push({ id: item.id, durationMs: Math.round(performance.now() - start), analysis: null, errorCode: error instanceof AppError && allowed.includes(error.code) ? error.code : 'MODEL_FAILED' });
    } finally { clearTimeout(timeout); }
  }
  return { formatVersion: 1, source, provider: 'google', model, caseChecksum: digest(cases), startedAt, results };
}
export interface ScoreSheet { evaluator: string | null; reportChecksum: string | null; scores: { id: string; translation: boolean | null; context: boolean | null; explanation: boolean | null; traditionalChinese: boolean | null; notes: string }[]; }
export function reportChecksum(report: QualityReport) { return createHash('sha256').update(JSON.stringify(report)).digest('hex'); }
export function scoreQuality(report: QualityReport, sheet: ScoreSheet) {
  const cases = qualityCases();
  if (report.formatVersion !== 1 || !['real-model','fixture'].includes(report.source) || report.provider !== 'google' || typeof report.model !== 'string' || report.caseChecksum !== digest(cases) || report.results.length !== 40 || new Set(report.results.map(x => x.id)).size !== 40 || sheet.scores.length !== 40 || new Set(sheet.scores.map(x => x.id)).size !== 40) throw new Error('Case set and report must match all 40 cases');
  if (!sheet.evaluator?.trim() || sheet.reportChecksum !== reportChecksum(report)) throw new Error('Human evaluator and matching report checksum required');
  let passed = 0;
  const failures: string[] = [];
  for (const item of cases) {
    const result = report.results.find(x => x.id === item.id), score = sheet.scores.find(x => x.id === item.id);
    if (!result || !score || !Number.isFinite(result.durationMs) || result.durationMs < 0 || dimensions.some(x => typeof score[x] !== 'boolean')) throw new Error('Every case requires timing and four explicit human scores');
    const ok = !result.errorCode && Value.Check(AnalysisSchema, result.analysis) && result.analysis.kind === item.expectedKind && dimensions.every(x => score[x]);
    if (ok) passed++; else failures.push(item.id);
  }
  const times = report.results.map(x => x.durationMs).sort((a,b) => a-b);
  return { source: report.source, passed, total: 40, threshold: 36, accepted: report.source === 'real-model' && passed >= 36, failures, medianMs: (times[19] + times[20]) / 2, p95Ms: times[37] };
}
function save(path: string, value: unknown) { writeFileSync(externalPath(path, false), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
async function main() {
  const { values } = parseArgs({ options: { list: { type: 'boolean' }, run: { type: 'boolean' }, score: { type: 'string' }, scores: { type: 'string' }, output: { type: 'string' }, template: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('npm run test:quality -- --list\n--run --output /external/report.json (EN_DIC_QUALITY_CONFIG: external JSON with apiKey and optional model)\n--template /external/report.json --output /external/scores.json\n--score /external/report.json --scores /external/scores.json\nOnly --run calls Gemini; score requires all 40 human reviews and 36 passes. Reports remain outside the project.'); return; }
  if ([values.list, values.run, values.score, values.template].filter(Boolean).length !== 1) throw new Error('Choose one quality operation');
  if (values.list) { console.log(JSON.stringify(qualityCases(), null, 2)); return; }
  if (values.template) {
    if (!values.output) throw new Error('Output path required');
    const report = externalJson(values.template) as unknown as QualityReport;
    save(values.output, { evaluator: null, reportChecksum: reportChecksum(report), scores: qualityCases().map(x => ({ id: x.id, translation: null, context: null, explanation: null, traditionalChinese: null, notes: '' })) }); return;
  }
  if (values.score) {
    if (!values.scores) throw new Error('Score sheet required');
    const summary = scoreQuality(externalJson(values.score) as unknown as QualityReport, externalJson(values.scores) as unknown as ScoreSheet);
    console.log(JSON.stringify(summary)); if (!summary.accepted) process.exitCode = 1; return;
  }
  if (!values.output || !process.env.EN_DIC_QUALITY_CONFIG) throw new Error('External quality configuration and output path required');
  // Reject unsafe output destinations before any paid/network work.
  const target = externalPath(values.output, false);
  if (existsSync(target)) throw new Error('Output file already exists');
  const config = externalJson(process.env.EN_DIC_QUALITY_CONFIG);
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim() || (config.model !== undefined && typeof config.model !== 'string')) throw new Error('Quality configuration needs a Gemini apiKey');
  const report = await runQuality(piAnalyzer(), config.model as string ?? DEFAULT_MODEL, config.apiKey, 'real-model');
  save(values.output, report);
  console.log(JSON.stringify({ total: report.results.length, failures: report.results.filter(x => x.errorCode).map(x => ({ id: x.id, code: x.errorCode })), humanReview: 'pending', reportChecksum: reportChecksum(report) }));
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) void main().catch(() => { console.error('Quality operation failed; check external paths, configuration, report and complete human score sheet. No provider details are logged.'); process.exitCode = 1; });
