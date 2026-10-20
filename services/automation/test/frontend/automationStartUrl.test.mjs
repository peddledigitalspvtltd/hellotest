import test from 'node:test';
import assert from 'node:assert/strict';
import { automationStartUrlError, reviewedAutomationStartUrl } from '../../frontend/lib/automationStartUrl.ts';

test('browser builds require a literal reviewed URL and preserve its full path, query, and fragment', () => {
  assert.match(automationStartUrlError('', true), /Start URL/);
  assert.throws(() => reviewedAutomationStartUrl('', true), /Start URL/);
  const exact = 'https://application.example.test/signup?workspace=customer#account';
  assert.equal(reviewedAutomationStartUrl(` ${exact} `, true), exact);
  assert.equal(reviewedAutomationStartUrl('http://127.0.0.1:8080/fixture', true), 'http://127.0.0.1:8080/fixture');
});

test('relative, non-web, credential-bearing URLs cannot silently use another application', () => {
  for (const value of ['/signup', '//application.test', 'application.test', 'file:///tmp/app.html', 'javascript:alert(1)', 'https://name:secret@application.test', 'https://name@application.test']) {
    assert.notEqual(automationStartUrlError(value, true), '', value);
    assert.throws(() => reviewedAutomationStartUrl(value, true), undefined, value);
  }
});

test('API and native-only builds do not require browser navigation, while invalid supplied URLs remain errors', () => {
  assert.equal(reviewedAutomationStartUrl('', false), undefined);
  assert.equal(automationStartUrlError('', false), '');
  assert.throws(() => reviewedAutomationStartUrl('/guess-this-page', false), /HTTP or HTTPS/);
});
