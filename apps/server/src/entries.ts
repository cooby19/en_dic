import type { Entry } from '@en-dic/shared';
import type { Sql } from './db.js';
import { AppError, missing } from './errors.js';
export function entry(row: Record<string, any>): Entry {
  const iso = (value: unknown) => value == null ? null : new Date(value as string).toISOString();
  return { id: row.id, original: row.original, context: row.context, analysis: row.analysis, provider: row.provider, model: row.model,
    source: row.source, notes: row.notes, favorite: row.favorite, createdAt: iso(row.created_at)!, favoritedAt: iso(row.favorited_at),
    expiresAt: iso(row.expires_at), review: row.review, reviewedAt: iso(row.reviewed_at), analysisVersion: row.analysis_version };
}
export async function detail(sql: Sql, id: string): Promise<Entry> {
  const row = (await sql.query('select * from private.entries where id=$1', [id])).rows[0];
  if (!row) throw missing(); return entry(row);
}
export function decodeCursor(cursor?: string): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 256) throw new Error();
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (typeof parsed.at !== 'string' || !Number.isFinite(Date.parse(parsed.at)) || !/^[a-f0-9-]{36}$/.test(parsed.id)) throw new Error();
    return parsed;
  } catch { throw new AppError(400, 'INVALID_CURSOR', '分頁位置無效，請重新載入。'); }
}
export async function list(sql: Sql, kind: 'favorites' | 'history', search = '', cursor?: string) {
  const position = decodeCursor(cursor), column = kind === 'favorites' ? 'favorited_at' : 'created_at';
  const { rows } = await sql.query(`select * from private.entries where favorite=$1
    and (strpos(lower(original),lower($2))>0 or strpos(lower(analysis->>'translation'),lower($2))>0)
    and ($3::timestamptz is null or (${column},id)<($3::timestamptz,$4::uuid)) order by ${column} desc,id desc limit 31`, [kind === 'favorites', search, position?.at ?? null, position?.id ?? null]);
  const page = rows.slice(0, 30), last = page.at(-1);
  return { entries: page.map(entry), nextCursor: rows.length > 30 ? Buffer.from(JSON.stringify({ at: new Date(last![column]).toISOString(), id: last!.id })).toString('base64url') : null };
}
