const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { projectBrowserModelTool } = require('../../backend/lib/automationBrowserModelContext');
const fixture = require('../fixtures/automationBrowserAssert.v1.json');
const stable = value => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

test('the versioned public fixture is the complete pinned native export, including description, schema and annotations', async t => {
  assert.equal(fixture.schema_version, 1);
  assert.equal(fixture.contract_version, 'hellotest_browser_assert_v1');
  assert.equal(hash(fixture.tool), fixture.sha256);
  const engineFile = path.resolve(__dirname, '../../../../testengine/backend/dist/lib/automationMcp.js');
  if (!existsSync(engineFile)) { t.skip('Build the pinned TestEngine to compare its native export; fixture/hash behavior is covered independently.'); return; }
  const engine = await import(pathToFileURL(engineFile).href);
  const native = engine.automationBrowserTools.find(tool => tool.name === 'browser_assert');
  assert.deepEqual(native, fixture.tool, 'a native contract update requires an explicit projection/fixture review');
});

test('only the exact native contract gets concise prose while schema, annotations and input object remain unchanged', () => {
  const original = structuredClone(fixture.tool), before = structuredClone(original), projected = projectBrowserModelTool(original);
  assert.notEqual(projected, original);
  assert.deepEqual(original, before);
  assert.deepEqual({ ...projected, description: original.description }, original);
  assert.deepEqual(projected.inputSchema, original.inputSchema);
  assert.deepEqual(projected.annotations, original.annotations);
  assert.notEqual(projected.inputSchema, original.inputSchema);
  assert.notEqual(projected.annotations, original.annotations);
  assert.ok(projected.description.length < original.description.length * .7);
  assert.ok(original.description.length - projected.description.length > 1000);
});

test('changed description, nested schema, annotations, unknown metadata or tool name pass through byte-for-byte', () => {
  const variants = [
    tool => { tool.description += ' External provider semantics'; },
    tool => { tool.inputSchema.properties.assertion.enum.push('external_predicate'); },
    tool => { tool.inputSchema.oneOf[0].required.push('value'); },
    tool => { tool.annotations.readOnlyHint = false; },
    tool => { tool.annotations.external_contract = 'retain exact provider metadata'; },
    tool => { tool.external_metadata = { proprietary_argument_rules: true }; },
    tool => { delete tool.annotations; },
    tool => { tool.name = 'external_browser_assert'; }
  ];
  for (const mutate of variants) {
    const changed = structuredClone(fixture.tool); mutate(changed);
    const before = JSON.stringify(changed), projected = projectBrowserModelTool(changed);
    assert.equal(projected, changed);
    assert.equal(JSON.stringify(projected), before);
  }
});

test('canonical object ordering does not change the bound contract and malformed unknown metadata fails open without rewriting', () => {
  const reordered = Object.fromEntries(Object.entries(fixture.tool).reverse());
  assert.notEqual(projectBrowserModelTool(reordered).description, reordered.description);
  const cyclic = structuredClone(fixture.tool); cyclic.external_metadata = cyclic;
  assert.equal(projectBrowserModelTool(cyclic), cyclic);
  for (const unknown of [null, [], 'browser_assert', { name: 'browser_assert' }, { name: 'browser_fill', description: 'Retain' }]) assert.equal(projectBrowserModelTool(unknown), unknown);
});

test('concise native description retains assertion subjects, exactness, error-association bounds and proof limits', () => {
  const description = projectBrowserModelTool(fixture.tool).description;
  for (const clause of [/read-only/, /inputSchema/, /hidden permits zero/, /count permits many/, /text\/text_contains/, /visible innerText/, /whole target/, /descendant buttons/, /not ARIA labels/,
    /authored equality/, /authored fragment/, /volatile IDs/, /Snapshot text is a textContent excerpt/, /native DOM text incl hidden children/, /value\/url\/title exact/, /literal same-origin substring/,
    /title_normalized native whitespace/, /validity\.valid with willValidate=true/, /field_valid/, /visible native value-entry input\/textarea\/select/, /aria-invalid absent\/false/, /aria-errormessage/, /aria-describedby role=alert/,
    /unique same-root IDs/, /max32 IDs\/256 chars/, /otherwise unsupported/, /No events or submission/, /Does not prove server\/business\/form-wide success/, /absence of all application errors/, /passed test run/, /Values withheld/]) assert.match(description, clause);
});
