import { Type, type Static } from 'typebox';
const text = (maxLength = 2000) => Type.String({ minLength: 1, maxLength });
const base = { translation: text(6000), ambiguity: Type.String({ maxLength: 2000 }) };
export const AnalysisSchema = Type.Union([
  Type.Object({ ...base, kind: Type.Literal('word'), partOfSpeech: text(100), usage: text(), meanings: Type.Array(text(1000), { minItems: 1, maxItems: 8 }) }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal('phrase'), usage: text(), example: text() }, { additionalProperties: false }),
  Type.Object({ ...base, kind: Type.Literal('sentence'), structure: text(4000), vocabulary: Type.Array(Type.Object({ english: text(300), meaning: text(1000) }, { additionalProperties: false }), { maxItems: 20 }) }, { additionalProperties: false }),
]);
export type Analysis = Static<typeof AnalysisSchema>;
export const QuerySchema = Type.Object({ original: text(3000), context: Type.Optional(Type.String({ maxLength: 1000 })), requestId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
export type QueryInput = Static<typeof QuerySchema>;
export const UpdateSchema = Type.Object({ favorite: Type.Optional(Type.Boolean()), source: Type.Optional(Type.String({ maxLength: 1000 })), notes: Type.Optional(Type.String({ maxLength: 4000 })) }, { additionalProperties: false, minProperties: 1 });
export interface Entry {
  id: string; original: string; context: string; analysis: Analysis; provider: 'google'; model: string;
  source: string; notes: string; favorite: boolean; createdAt: string; favoritedAt: string | null;
  expiresAt: string | null; review: 'remembered' | 'learning' | null; reviewedAt: string | null; analysisVersion: 1;
}
export interface Connection { connected: boolean; model: string; version: number; testedAt: string | null; status: 'connected' | 'disconnected' | 'error'; }
export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export function normalize(value: string): string { return value.normalize('NFC').trim().replace(/\s+/gu, ' '); }
