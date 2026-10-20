const test = require('node:test'), assert = require('node:assert/strict');
const { sameRecordedLocator, recordedLocatorIdentity } = require('../../backend/lib/automationLocatorIdentity');

test('closed locator spellings share identity while preserving exact names, indices and subjects', () => {
  for (const [left, right] of [
    ['#email', 'locator("#email")'],
    ['getByLabel("Email")', 'page.getByLabel("Email", {exact:true})'],
    ['label="Email"', 'getByLabel("Email", {exact:true})'],
    ['role=button[name="Save"]', 'getByRole("button", {exact:true,name:"Save"})'],
    ['getByRole("button", {name:"Save",exact:false})', 'getByRole("button", {exact:false,name:"Save"})'],
    ['getByLabel("Email").nth(1)', 'page.getByLabel(`Email`, {exact:true}).nth( 1 )']
  ]) assert.equal(sameRecordedLocator(left, right), true, `${left} === ${right}`);
  for (const [left, right] of [
    ['#email', '#password'], ['#email', 'getByLabel("Email")'],
    ['getByLabel("Email")', 'getByLabel("Email",{exact:false})'],
    ['getByLabel("Email").first()', 'getByLabel("Email").last()'],
    ['getByRole("button", {name:"Save"})', 'getByRole("button",{name:"Save changes"})']
  ]) assert.equal(sameRecordedLocator(left, right), false, `${left} !== ${right}`);
  assert.equal(recordedLocatorIdentity('getByLabel(dynamic)'), null);
  assert.equal(sameRecordedLocator('getByLabel(dynamic)', '#email'), false);
});
