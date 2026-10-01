import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
export interface Config { origin: string; databaseUrl: string; supabaseUrl: string; supabasePublishableKey: string; port: number; }
export function loadConfig(): Config {
  const path = process.env.EN_DIC_CONFIG;
  if (!path || !isAbsolute(path)) throw new Error('Set EN_DIC_CONFIG to an absolute configuration path outside the project');
  const root = resolve(import.meta.dirname, '../../..');
  const inside = relative(root, resolve(path));
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('Configuration must be outside the project');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of ['origin', 'databaseUrl', 'supabaseUrl', 'supabasePublishableKey']) if (typeof data[key] !== 'string' || !data[key]) throw new Error(`Missing configuration field: ${key}`);
  const origin = new URL(data.origin);
  if (origin.origin !== data.origin || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Origin must be HTTPS (except localhost) and contain no path');
  if (new URL(data.supabaseUrl).protocol !== 'https:') throw new Error('Supabase URL must be HTTPS');
  return { ...data, port: Number(process.env.PORT || data.port || 3000) };
}
