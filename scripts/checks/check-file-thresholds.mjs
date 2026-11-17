#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function reviewLargeFiles(files, plans, threshold = 1200) {
  const violations = [], reviewed = [];
  for (const { file, lines } of files) {
    if (lines <= threshold) continue;
    const plan = plans[file];
    if (!plan || !plan.owner || !plan.rationale || !Array.isArray(plan.seams) || !plan.seams.length || !Array.isArray(plan.validation) || !plan.validation.length || !Number.isInteger(plan.max_lines)) {
      violations.push({ file, lines, reason: 'A reviewed owner, split seams, validation and line ceiling are required.' }); continue;
    }
    if (lines > plan.max_lines) violations.push({ file, lines, ceiling: plan.max_lines, reason: 'The reviewed line ceiling increased; update the split review.' });
    else reviewed.push({ file, lines, ceiling: plan.max_lines, owner: plan.owner });
  }
  return { ok: !violations.length, threshold, reviewed, violations };
}

export function collectSourceFiles(root) {
  const files = [];
  const excluded = new Set(['node_modules', 'dist', 'test', 'tests', 'vendor', 'public', 'artifacts', '.git']);
  function walk(dir) {
    for (const row of readdirSync(dir, {withFileTypes: true})) {
      if (excluded.has(row.name)) continue;
      const file = resolve(dir, row.name);
      if (row.isDirectory()) walk(file);
      else if (/\.(?:[cm]?js|jsx|ts|tsx|css)$/.test(file) && !file.endsWith('.d.ts')) {
        files.push({file: relative(root, file).replaceAll('\\', '/'), lines: readFileSync(file, 'utf8').split('\n').length});
      }
    }
  }
  for (const service of readdirSync(resolve(root, 'services'), {withFileTypes: true})) {
    if (service.isDirectory() && !excluded.has(service.name)) walk(resolve(root, 'services', service.name));
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const files = collectSourceFiles(root);
  const plans = JSON.parse(readFileSync(resolve(root, 'docs/architecture/large-file-split-plans.json'), 'utf8'));
  const result = reviewLargeFiles(files, plans.files, plans.threshold);
  for (const [file, plan] of Object.entries(plans.files)) for (const target of plan.validation || []) if (!existsSync(resolve(root, target))) { result.ok = false;result.violations.push({ file, reason: `Missing validation source: ${target}` }); }
  console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
}
