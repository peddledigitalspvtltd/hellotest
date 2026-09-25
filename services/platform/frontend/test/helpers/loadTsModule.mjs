import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

// Executes the real local import graph with an isolated browser environment.
export function loadTsModule(filename, globals = {}, environment = {}) {
  const cache = new Map();
  function load(file) {
    file = [file, `${file}.ts`, resolve(file, 'index.ts')].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
    if (!file) throw new Error('Missing local TypeScript module');
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = readFileSync(file, 'utf8').replaceAll('import.meta.env', '__testEnvironment');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, {
      ...globals, module, exports: module.exports, __testEnvironment: environment,
      require: name => name.startsWith('.') ? load(resolve(dirname(file), name)) : name.startsWith('@hellotest/') ? load(createRequire(file).resolve(name)) : createRequire(file)(name)
    }, { filename: file });
    return module.exports;
  }
  return load(filename);
}
