import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSourceFiles, reviewLargeFiles } from './check-file-thresholds.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('large production files require concrete split reviews and cannot silently grow past their reviewed ceiling', () => {
  const file = 'services/automation/backend/services/dispatch.js', files = [{ file, lines: 1400 }];
  assert.equal(reviewLargeFiles(files, {}).ok, false);
  const plan = { owner: 'automation', rationale: 'Keep queue receipts atomic while extracting policy.', seams: ['queue receipts', 'lease lifecycle'], validation: ['receipt rollback integration'], max_lines: 1400 };
  assert.equal(reviewLargeFiles(files, { [file]: plan }).ok, true);
  assert.equal(reviewLargeFiles([{ file, lines: 1401 }], { [file]: plan }).ok, false);
  assert.equal(reviewLargeFiles([{ file, lines: 1200 }], {}).ok, true);
  assert.equal(reviewLargeFiles(files, { [file]: { ...plan, validation: [] } }).ok, false);
});

test('the size gate covers every service and CSS/JS module variant while excluding generated dependencies and tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'qaira-file-gate-'));
  try {
    const services = ['platform', 'testing', 'manual', 'automation', 'ai', 'agentic', 'chatbot', 'knowledge', 'integration', 'dashboard', 'mcp', 'trace', 'contracts'];
    for (const service of services) {
      const dir = join(root, 'services', service, 'frontend');
      mkdirSync(dir, { recursive: true });
      for (const extension of ['css', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx']) writeFileSync(join(dir, `source.${extension}`), 'source\n');
      for (const excluded of ['node_modules', 'dist', 'test', 'tests', 'vendor', 'public', 'artifacts']) {
        mkdirSync(join(dir, excluded)); writeFileSync(join(dir, excluded, 'ignored.css'), 'ignored\n');
      }
      writeFileSync(join(dir, 'declarations.d.ts'), 'type Only = string;\n');
    }
    const files = collectSourceFiles(root);
    assert.equal(files.length, services.length * 7);
    for (const service of services) assert.ok(files.some(row => row.file === `services/${service}/frontend/source.css`), service);
    assert.ok(files.every(row => row.lines === 2));
    assert.ok(files.every(row => !row.file.includes('ignored') && !row.file.endsWith('.d.ts')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
