import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const ts = createRequire(new URL('../../../../package.json',import.meta.url))('typescript');
const engineModules = path.dirname(path.dirname(require.resolve('playwright/package.json')));

/** Compile the actual standalone file against public Playwright/Node declarations. */
export function assertTypeScriptExportCompiles(fileNames) {
  const program = ts.createProgram(fileNames, {
    noEmit: true, strict: true, skipLibCheck: true, allowJs: true, checkJs: false,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['node'], typeRoots: [path.join(engineModules,'@types')],
    baseUrl: engineModules,
    paths: { '@playwright/test': ['playwright/test.d.ts'], 'jsonpath-plus': ['jsonpath-plus/src/jsonpath.d.ts'], ajv: ['ajv/dist/ajv.d.ts'] }
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{
    getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:name=>name,getNewLine:()=> '\n'
  }));
}
