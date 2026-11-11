import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { canonicalAutomationTabUrl, TAB_IDENTITY_SCHEMA, automationTabIdentityUrl } from '../dist/lib/automationTabIdentity.js';
import { buildPlaywrightArtifact } from '../../../services/automation/shared/playwrightArtifact.mjs';
const require = createRequire(import.meta.url);
const native = require('../../../services/automation/backend/lib/automationUpstreamTabs.js');

test('native receipts, runner and standalone share the versioned semantic URL contract', () => {
  const artifact = buildPlaywrightArtifact({ testCase: { id: 'identity', title: 'Identity' }, steps: [{ id: 's', step_type: 'web', automation_code: 'await web.switchTab({index:1});' }] });
  const tree = ts.createSourceFile('artifact.ts', artifact, ts.ScriptTarget.Latest, true);
  let declaration;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'canonicalAutomationTabUrl') declaration = node; ts.forEachChild(node, visit); };
  visit(tree); assert.ok(declaration, 'the exported runtime includes its identity implementation');
  const source = ts.transpileModule(`const ${declaration.getText(tree)}; module.exports=canonicalAutomationTabUrl;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: undefined }; new Function('module', source)(module);
  const exported = module.exports;
  const vectors = [
    ['https://app.test/record?id=alice&utm_source=build', 'https://app.test/record?id=alice'],
    ['https://app.test/record?id=bob', 'https://app.test/record?id=bob'],
    ['https://app.test/#/record/alice?view=full&utm_source=build', 'https://app.test/#/record/alice?view=full'],
    ['https://app.test/#/record/bob', 'https://app.test/#/record/bob'],
    ['https://app.test/record?z=2&id=alice&fbclid=volatile', 'https://app.test/record?id=alice&z=2'],
    ['https://app.test/record?qid=123&token=identity', 'https://app.test/record?qid=123&token=identity'],
    ['https://www.amazon.in/dp/B012345678?qid=123&ref=search&th=1&psc=1', 'https://www.amazon.in/dp/B012345678?psc=1&th=1'],
    ['https://amazon.com.evil/record?qid=123', 'https://amazon.com.evil/record?qid=123'],
    ['https://app.test/record?id=alice&id=bob#details', 'https://app.test/record?id=alice&id=bob#details'],
    ['https://app.test/record?id=bob&id=alice#details', 'https://app.test/record?id=bob&id=alice#details'],
    ['file:///private/file', undefined], ['https://user:password@app.test/record', undefined], ['invalid', undefined]
  ];
  assert.equal(native.TAB_IDENTITY_SCHEMA, TAB_IDENTITY_SCHEMA);
  for (const [input, expected] of vectors) for (const implementation of [native.canonicalAutomationTabUrl, canonicalAutomationTabUrl, exported]) assert.equal(implementation(input), expected, input);
  assert.throws(() => automationTabIdentityUrl({ schema: 'hellotest.tab-identity.v2', url: 'https://app.test/' }), /Unsupported/);
});
