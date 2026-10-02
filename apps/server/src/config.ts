import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
export interface Config { origin: string; databaseUrl: string; supabaseUrl: string; supabasePublishableKey: string; port: number; }
export const projectRoot = realpathSync(resolve(import.meta.dirname, '../../..'));
const contains = (root: string, path: string) => { const part = relative(root, path); return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('../')); };
export function externalPath(path: string, existing = true): string {
  if (!isAbsolute(path)) throw new Error('Configuration and private artifacts require an absolute path outside the project');
  try {
    const physical = existing ? realpathSync(path) : resolve(realpathSync(dirname(path)), basename(path));
    if (contains(projectRoot, resolve(path)) || contains(projectRoot, physical)) throw new Error();
    return physical;
  } catch { throw new Error('Path must resolve outside the project and be accessible'); }
}
export function externalJson(path: string): Record<string, unknown> {
  try { const data: unknown = JSON.parse(readFileSync(externalPath(path), 'utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data as Record<string, unknown>; }
  catch { throw new Error('Cannot read external JSON configuration'); }
}
export function loadConfig(): Config {
  const path = process.env.EN_DIC_CONFIG;
  if (!path || !isAbsolute(path)) throw new Error('Set EN_DIC_CONFIG to an absolute configuration path outside the project');
  const data = externalJson(path);
  for (const key of ['origin', 'databaseUrl', 'supabaseUrl', 'supabasePublishableKey']) if (typeof data[key] !== 'string' || !data[key]) throw new Error(`Missing configuration field: ${key}`);
  try {
    const origin = new URL(data.origin as string), supabase = new URL(data.supabaseUrl as string), database = new URL(data.databaseUrl as string);
    if (origin.origin !== data.origin || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) throw new Error();
    if (supabase.protocol !== 'https:' || supabase.username || supabase.password || supabase.search || supabase.hash) throw new Error();
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error();
    const port = Number(process.env.PORT ?? data.port ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    return { origin: data.origin as string, databaseUrl: data.databaseUrl as string, supabaseUrl: data.supabaseUrl as string, supabasePublishableKey: data.supabasePublishableKey as string, port };
  } catch { throw new Error('Invalid origin, database URL, Supabase URL or port in configuration'); }
}
