import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(new URL('../package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const exports = {};
const source = readFileSync(new URL('../src/shared/components/FormField.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function('exports', 'require', code)(exports, require);
const { FormField } = exports;
const render = (props, child) => renderToStaticMarkup(createElement(FormField, props, child));

test('a composite wrapper preserves its control ID for the label, hint and error associations', () => {
  const html = render({ composite: true, inputId: 'credential', label: 'Credential', hint: 'Entry guidance', error: 'Entry is invalid' },
    createElement('div', { id: 'credential-shell' }, createElement('input', { id: 'credential', 'aria-describedby': 'credential-hint credential-error', 'aria-invalid': true })));
  assert.match(html, /<label[^>]+for="credential"/);
  assert.match(html, /<p[^>]+id="credential-hint"/);
  assert.match(html, /<span[^>]+id="credential-error"[^>]+role="alert"/);
  assert.match(html, /<div id="credential-shell"><input/);
  assert.doesNotMatch(html, /credential-shell-(?:hint|error)|<div[^>]+aria-(?:invalid|describedby)/);
});

test('a direct control retains its existing ID and receives uniquely matching hint and error references', () => {
  const html = render({ inputId: 'fallback', label: 'Code', hint: 'Entry guidance', error: 'Entry is invalid' }, createElement('input', { id: 'code' }));
  assert.match(html, /for="code"/);
  assert.match(html, /aria-describedby="code-error code-hint"/);
  assert.match(html, /id="code-hint"/);
  assert.match(html, /id="code-error"/);
  assert.doesNotMatch(html, /fallback-(?:error|hint)/);
});
