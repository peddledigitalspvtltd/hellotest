import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const exports = {};
new Function('require', 'exports', ts.transpileModule(
  readFileSync(new URL('../src/components/AiLlmSelect.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }
).outputText)(name => name.endsWith('.css') ? {} : require(name), exports);
const integrations = [{ id: 'first', name: 'First provider', model: 'model-a' }, { id: 'second', name: 'Second provider' }];
const render = props => renderToStaticMarkup(React.createElement(exports.AiLlmSelect, { integrations, onChange() {}, ...props }));

test('LLM dropdown keeps automatic selection distinct from the first provider', () => {
  let changes = 0;
  const html = render({ id: 'test-llm', value: '', onChange: () => changes++ });
  assert.match(html, /<label[^>]*for="test-llm"[^>]*><span id="test-llm-label">LLM<\/span>/);
  assert.match(html, /<select[^>]*aria-labelledby="test-llm-label"[^>]*id="test-llm"/);
  assert.match(html, /<option value="" selected="">Configured LLM<\/option>/);
  assert.match(html, /<option value="first">First provider · model-a<\/option>/);
  assert.equal(changes, 0, 'Rendering never silently selects a provider');
});

test('explicit unavailable selection remains visible instead of falling back', () => {
  const html = render({ value: 'retired-provider' });
  assert.match(html, /<option disabled="" value="retired-provider" selected="">retired-provider \(unavailable\)<\/option>/);
  assert.doesNotMatch(html, /<option value="" selected=/);
});

test('disabled state, empty catalog and automatic label are preserved', () => {
  const html = render({ integrations: [], value: '', disabled: true, autoLabel: 'Configured project LLM' });
  assert.match(html, /<select[^>]*disabled=""/);
  assert.match(html, /<option value="" selected="">Configured project LLM<\/option>/);
  assert.equal((html.match(/<option/g) || []).length, 1);
});
