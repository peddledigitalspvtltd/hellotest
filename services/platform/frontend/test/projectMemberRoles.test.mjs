import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/platform/lib/projectMemberRoles.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);

test('create and update role catalogs retain all configured assignable roles without inventing missing roles', () => {
  const roles = [{ id: 'administrator', name: 'admin' }, { id: 'jira-admin', name: 'Jira Administrator' }, { id: 'custom-owner', name: 'Product Owner' }, { id: 'automation', name: 'Automation Engineer' }, { id: 'custom-reviewer', name: 'Delivery Reviewer' }];
  assert.deepEqual(exports.getAssignableProjectRoles(roles), roles.slice(2));
  assert.equal(exports.getDefaultProjectMemberRoleId(roles.slice(2)), 'custom-owner');
  assert.equal(exports.getDefaultProjectMemberRoleId([]), '');
  assert.equal(exports.getDefaultProjectMemberRoleId([{ id: 'configured-default', name: 'member' }, ...roles.slice(2)]), 'configured-default');
});
