import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributeLocator, isRepositoryMemberUsed } from '../../frontend/lib/repositoryLocators.ts';
test('combines captured attributes, scope and explicit zero-based index without losing escaping', () => {
  assert.equal(buildAttributeLocator('INPUT', [['name', 'email'], ['data-label', 'say "hello"']], 'form#login', 1), 'form#login input[name="email"][data-label="say \\"hello\\""] >> nth=1');
  assert.equal(buildAttributeLocator('button', [], '', 0), 'button >> nth=0');
  assert.equal(buildAttributeLocator('button', [], '', -1), 'button');
});
test('case repository bindings exclude unrelated objects and similarly named fields', () => {
  const member = { ref: 'Login.Email', entry: { id: 'field', locator: '[name="email"]' } };
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: 'await page.locator("Login.Email").fill("x");' }]), true);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: 'await page.locator("OtherLogin.Email").click();' }]), false);
  assert.equal(isRepositoryMemberUsed(member, undefined, []), false);
  assert.equal(isRepositoryMemberUsed({ ...member, entry: { ...member.entry, test_case_id: 'case' } }, 'case', []), true);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: '// await web.fill("Login.Email", "example");' }]), false);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: '/* "Login.Email" */ await web.click("Login.Submit");' }]), false);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ objectRefs: ['Login.Email'] }]), true);
  assert.equal(isRepositoryMemberUsed(member, 'case', [{ automation_code: 'await web.fill("[name=\\"email\\"]", "example");' }]), true);
});
