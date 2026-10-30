import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const module = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/sprintDraftResults.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(module);
const { collectSprintDrafts } = module;
const stage = (id, data) => ({node_id:id,node_type:'artifactTask',status:'completed',output:{data}});
const story = id => ({story_id:id,story_revision:'r1',story:{title:'Story '+id}});
const draft = id => ({client_id:'case-'+id,title:'Case '+id});
const assessment = id => ({client_id:'case-'+id,case_index:0,analysis:{},assurance_review:{summary:'Reviewed '+id}});

test('owned stage outputs assemble complete results and target the correct native checkpoint after reordered inputs', () => {
  const run = {node_results:[
    stage('stories',['a','b'].map(id=>({...story(id),story_assurance:{analysis:{summary:'Assessed '+id}}}))),
    stage('generate',['a','b'].map(id=>({...story(id),cases:[draft(id)]}))),
    stage('assess',['b','a'].map(id=>({...story(id),case_assurance:[assessment(id)]}))),
    stage('build',['b','a'].map(id=>({...story(id),automation:[{client_id:'case-'+id,case_index:0,executable:{code:'test('+id+')'}}]})))
  ]};
  const results = collectSprintDrafts(run);
  assert.equal(results.length,2);
  assert.equal(results[0].packet.cases[0].title,'Case a');
  assert.equal(results[0].packet.case_assurance[0].assurance_review.summary,'Reviewed a');
  assert.equal(results[0].packet.automation[0].executable.code,'test(a)');
  assert.deepEqual(results[0].automationTarget,{nodeId:'build',storyIndex:1});
  assert.deepEqual(results[0].manualTarget,{nodeId:'build',storyIndex:1});
});

test('regeneration and mismatched client identities cannot attach earlier review or automation to a new case', () => {
  const results = collectSprintDrafts({node_results:[
    stage('generate',[{...story('a'),cases:[draft('old')]}]),
    stage('assess',[{...story('a'),case_assurance:[assessment('old')]}]),
    stage('regenerate',[{...story('a'),cases:[draft('new')]}]),
    stage('old-branch',[{...story('a'),automation:[{client_id:'case-old',case_index:0}]}])
  ]});
  assert.equal(results[0].packet.cases[0].client_id,'case-new');
  assert.equal(results[0].packet.case_assurance,undefined);
  assert.equal(results[0].packet.automation,undefined);
  assert.equal(results[0].manualTarget,undefined);
  assert.equal(results[0].automationTarget,undefined);
});

test('legacy saved cumulative results remain reviewable and Story revisions never mix', () => {
  const row={...story('a'),cases:[draft('a')],case_assurance:[assessment('a')],automation:[{client_id:'case-a',case_index:0}]};
  const results=collectSprintDrafts({node_results:[stage('legacy',[row]),stage('new-revision',[{...story('a'),story_revision:'r2',cases:[draft('a2')]}])]});
  assert.equal(results.length,2);
  assert.equal(results[0].packet.automation[0].client_id,'case-a');
  assert.equal(results[1].packet.case_assurance,undefined);
  assert.deepEqual(results[0].automationTarget,{nodeId:'legacy',storyIndex:0});
});
