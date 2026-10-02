import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrations } from '../scripts/migrate.js';

test('tool entrypoints list/help offline and fail safely without external configuration', () => {
  for (const script of ['migrate','quality']) {
    for (const mode of ['--help','--list']) {
      const output = execFileSync(process.execPath,['--import','tsx',`scripts/${script}.ts`,mode],{ encoding:'utf8' });
      assert.ok(output.length > 0);
    }
    const env = { ...process.env }; delete env.EN_DIC_MIGRATION_CONFIG; delete env.EN_DIC_QUALITY_CONFIG;
    const result = spawnSync(process.execPath,['--import','tsx',`scripts/${script}.ts`],{ env,encoding:'utf8' });
    assert.equal(result.status,1); assert.ok(!result.stderr.includes('postgresql://'));
  }
  const directory = mkdtempSync(join(tmpdir(),'en-dic-tools-'));
  writeFileSync(join(directory,'20261002090000_first.sql'),'select 1');
  writeFileSync(join(directory,'20261002090000_duplicate.sql'),'select 2');
  assert.throws(() => readMigrations(directory),/duplicate/);
});
