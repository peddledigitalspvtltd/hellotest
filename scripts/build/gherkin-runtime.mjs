import fs from 'node:fs';
import ts from 'typescript';
import { createHash } from 'node:crypto';
const sourceUrl = new URL('../../services/testing/frontend/lib/gherkin.ts', import.meta.url);
const outputUrl = new URL('../../services/testing/shared/gherkin.mjs', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const generated = `// Generated from frontend/lib/gherkin.ts by scripts/build/gherkin-runtime.mjs. Source SHA256: ${createHash('sha256').update(source).digest('hex')}\n${ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText}`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(outputUrl, 'utf8') !== generated) throw new Error('Run node scripts/build/gherkin-runtime.mjs to refresh the native Gherkin parser runtime.');
} else fs.writeFileSync(outputUrl, generated);
