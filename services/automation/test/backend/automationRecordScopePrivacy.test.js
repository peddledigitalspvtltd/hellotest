const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');

test('private case parameter redaction removes record-locator claims without changing safe observed alternatives', () => {
  const resolver = createBrowserParameterResolver({ caseValues: { 't.record': '9private-record' }, privateParameterNames: ['t.record'] });
  const scoped = 'tr[data-row-id="9private-record"] > button';
  const original = { source: 'playwright', elements: [{ locators_validated: true, locator_candidates: [scoped, '#delete'], record_scoped_locator: scoped }] };
  const projected = JSON.parse(resolver.redactResult({ content: [{ type: 'text', text: JSON.stringify(original) }] }).content[0].text);
  assert.equal(projected.elements[0].record_scoped_locator, undefined);
  assert.ok(projected.elements[0].locator_candidates.includes('#delete'));
  assert.doesNotMatch(JSON.stringify(projected), /9private-record/);
  assert.equal(original.elements[0].record_scoped_locator, scoped, 'privacy projection cannot mutate host evidence');
});

test('record metadata requires an exact surviving validated candidate', () => {
  const resolver = createBrowserParameterResolver();
  const scoped = 'tr[data-row-id="owned-record"] > button';
  const elements = [
    { locator_candidates: [scoped], record_scoped_locator: scoped },
    { locator_candidates: ['#delete'], record_scoped_locator: scoped }
  ];
  const projected = JSON.parse(resolver.redactResult({ content: [{ type: 'text', text: JSON.stringify({ elements }) }] }).content[0].text);
  assert.equal(projected.elements[0].record_scoped_locator, scoped);
  assert.equal(projected.elements[1].record_scoped_locator, undefined);
});
