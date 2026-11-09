import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorderDisplayPrivacy } from '../../frontend/lib/recorderDisplayPrivacy.ts';

test('recorder presentation masks private inputs, locator aliases and sensitive URL values without modifying the captured plan', () => {
  const actions = [{ index: 1, type: 'fill', locator: '#password', value: 'unusual & value' },
    { index: 2, type: 'fill', locator: '#account', value: 'private-account' },
    { index: 3, type: 'click', locator: '[data-user="private-account"]', text: 'Continue' }];
  const original = structuredClone(actions), privacy = createRecorderDisplayPrivacy(actions, ['private-account']);
  assert.equal(privacy.actionText(actions[0]), '[private input]');
  assert.equal(privacy.actionText(actions[1]), '[private input]');
  assert.equal(privacy.actionText(actions[2]), 'Continue');
  assert.doesNotMatch(privacy.text(actions[2].locator), /private-account/);
  assert.doesNotMatch(privacy.url('https://fixture.test/next?access_token=unknown-secret&account=private-account&filter=active'), /unknown-secret|private-account/);
  assert.match(privacy.url('https://fixture.test/next?filter=active'), /filter=active/);
  assert.doesNotMatch(privacy.url('https://fixture.test/next?account=unusual+%26+value'), /unusual/);
  assert.doesNotMatch(privacy.text(encodeURIComponent('unusual & value')), /unusual/);
  assert.deepEqual(actions, original);
});

test('an explicit private parameter selection protects an otherwise unrecognized captured input', () => {
  const action = { index: 10, type: 'fill', locator: '#customer', value: 'custom private value' };
  const privacy = createRecorderDisplayPrivacy([action], [], new Set([10]));
  assert.equal(privacy.actionText(action), '[private input]');
  assert.doesNotMatch(privacy.url('https://fixture.test/custom%20private%20value'), /custom|private%20value/);
});
