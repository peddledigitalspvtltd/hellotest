import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(new URL('../package.json', import.meta.url));
const {createElement} = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = readFileSync(new URL('../src/shared/components/TileCardPrimitives.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
const exports = {};
new Function('exports', 'require', code)(exports, id => {
  if (id === 'react/jsx-runtime') return require(id);
  if (id.endsWith('/metricTitle')) return {metricTitle: label => label};
  if (id.endsWith('/aiPromptRegistry')) return {resolveMetricIdentity: () => null};
  return {};
});

test('recorded run facts retain their value and definition without announcing missing score governance', () => {
  const html = renderToStaticMarkup(createElement(exports.TileCardValue,
    {label: 'Cases', value: 4, title: 'Distinct test cases in this run'}));
  assert.match(html, /<strong>4<\/strong><span>Cases<\/span>/);
  assert.match(html, /title="Distinct test cases in this run"/);
  assert.doesNotMatch(html, /unavailable|unmapped|methodology|governed/i);
});

test('an actual metric without an identity still discloses unavailable methodology', () => {
  const html = renderToStaticMarkup(createElement(exports.TileCardMetric,
    {label: 'Unmapped score', value: '40%'}));
  assert.match(html, /data-metric-id="unmapped"/);
  assert.match(html, /Methodology unavailable/);
});
