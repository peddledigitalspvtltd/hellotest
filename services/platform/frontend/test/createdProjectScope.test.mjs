import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const module = {exports: {}};
const source = readFileSync(new URL('../src/platform/lib/createdProjectScope.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
new Function('exports', 'module', compiled)(module.exports, module);
const {activateCreatedProjectScope} = module.exports;

test('a new project is activated with its application only after authoritative scope is cached', async () => {
  const events = [];
  const result = await activateCreatedProjectScope({projectId: 'new', loadScopes: async () => ({projects: [{id: 'new', has_access: true}]}),
    loadApps: async id => { assert.equal(id, 'new'); return [{id: 'new-app'}]; },
    cacheScopes: snapshot => {events.push('cache'); assert.equal(snapshot.projects[0].id, 'new');},
    activate: (project, app) => {events.push('activate'); assert.deepEqual([project, app], ['new', 'new-app']);}});
  assert.equal(result, true);
  assert.deepEqual(events, ['cache', 'activate']);
});

test('a missing or revoked grant cannot activate the created project', async () => {
  for (const projects of [[], [{id: 'new', has_access: false}]]) {
    assert.equal(await activateCreatedProjectScope({projectId: 'new', loadScopes: async () => ({projects}), cacheScopes: () => {},
      loadApps: async () => {assert.fail('Do not retrieve applications without project access');}, activate: () => assert.fail('Do not activate unauthorized project')}), false);
  }
});

test('application recovery stays in the new authorized project instead of carrying the previous child scope', async () => {
  const activations = [];
  assert.equal(await activateCreatedProjectScope({projectId: 'new', loadScopes: async () => ({projects: [{id: 'new'}]}), cacheScopes: () => {},
    loadApps: async () => {throw new Error('Recovering');}, activate: (...args) => activations.push(args)}), true);
  assert.deepEqual(activations, [['new', '']]);
});
