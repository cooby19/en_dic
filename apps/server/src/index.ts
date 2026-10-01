import pg from 'pg';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { database, verifyRuntimeRole } from './db.js';
import { buildApp } from './app.js';
import { supabaseAuth } from './auth.js';
import { piAnalyzer } from './model.js';
async function main() {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, statement_timeout: 10000, connectionTimeoutMillis: 10000 });
  const db = database(pool); await db.system(verifyRuntimeRole);
  const app = await buildApp({ db, origin: config.origin, auth: supabaseAuth(config), analyzer: piAnalyzer(), staticRoot: resolve(import.meta.dirname, '../../web/dist') });
  app.addHook('onClose', async () => { await pool.end(); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.info('English dictionary service ready');
}
main().catch(() => { console.error('Startup failed. Check external configuration, database role and migrations.'); process.exitCode = 1; });
