import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as csvGrid from '../src/shared/lib/csvGrid.ts';
const load = (file, extra = {}) => {
  const module = {exports:{}};
  vm.runInNewContext(ts.transpileModule(readFileSync(sourceFile(`${file}.ts`, "lib"), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
    {module,exports:module.exports,require:name => {assert.equal(name.split('/').pop(),'csvGrid');return csvGrid;},...extra});
  return module.exports;
};
const {parseRequirementCsv,createStoryImportTemplate,validateStoryImportMetadata,resolveImportedRequirementPlanning} = load('requirementImport');
const plain = value => JSON.parse(JSON.stringify(value));
const metadata = {workflow_statuses:{default_status:'dev_ready',statuses:[{value:'dev_ready',label:'Dev Ready'},{value:'qa_done',label:'QA Done'}]},fields:[{id:'component',allowed_values:[{value:'Payments, Core'}]}]};
const sprints = [{id:'sprint-native',display_id:'SPR_7',name:'Sprint One',state:'active'}];
const releases = [{id:'release-native',name:'Autumn Release',fix_version:'v2',state:'planned'}];
test('downloaded metadata template round-trips quoted JSON, commas and multiline Story content', async () => {
  let savedBlob,filename;
  const {downloadCsvRecords} = load('csvExport',{Blob,URL:{createObjectURL:blob=>{savedBlob=blob;return 'blob:test';},revokeObjectURL:()=>{}},document:{createElement:()=>({set download(value){filename=value;},click(){}})},window:{setTimeout:callback=>callback()}});
  const template = createStoryImportTemplate(metadata,sprints,releases);
  template.Description='As an "owner", I want a report\nso that I can see results.';
  template.Labels=['smoke, nightly','a|b'];
  downloadCsvRecords('stories.csv',[template]);
  const parsed = parseRequirementCsv(await savedBlob.text());
  assert.equal(filename,'stories.csv');assert.deepEqual(plain(parsed.errors),[]);
  const row = resolveImportedRequirementPlanning(validateStoryImportMetadata(parsed.rows,metadata),sprints,releases)[0];
  assert.equal(row.description,template.Description);assert.deepEqual(plain(row.labels),template.Labels);
  assert.equal(row.acceptance_criteria[0],template['Acceptance Criteria'][0]);
  assert.equal(row.additional_fields.component,'Payments, Core');
  assert.equal(row.iteration_id,'sprint-native');assert.equal(row.release_id,'release-native');
  assert.equal(row.status,'dev_ready');assert.match(row.gherkin_scenarios[0],/\nScenario:/);
  assert.equal(row.story_id,undefined);assert.equal(row.linked_test_cases,undefined);
});
test('CSV refuses silent field loss, malformed rows and unsafe update identities', () => {
  for (const [csv,pattern] of [
    ['Title,Acceptance Criteria,Priority\nValid Story,Clear outcome,high',/Priority/],
    ['Title,Unexpected\nValid Story,value',/Unsupported column/],
    ['Title,Story\nValid Story,duplicate',/duplicates/],
    ['Title,Story ID\nValid Story,STORY_7',/Expected Revision/],
    ['Title,Dev Target Date\nValid Story,2026-02-30',/valid ISO date/],
    ['Title,Description\nValid Story,first,extra',/expected 2 columns/],
    ['Title,Additional Fields JSON\nValid Story,"{""_story_readiness"":{}}"',/reserved keys/]
  ]) assert.ok(parseRequirementCsv(csv).errors.some(error=>pattern.test(error)),csv);
  assert.throws(()=>parseRequirementCsv('Title,Description\nStory,"unfinished'),/quote/i);
});
test('explicit updates retain revisions and lists while blanks preserve omitted fields', () => {
  const parsed = parseRequirementCsv('Story ID,Expected Revision,Title,Acceptance Criteria,Description,Status,Linked Test Cases\nSTORY_7,3,Updated Story,[],,QA Done,"[""TC_3""]"');
  assert.deepEqual(plain(parsed.errors),[]);
  const row = validateStoryImportMetadata(parsed.rows,metadata)[0];
  assert.equal(row.expected_revision,3);assert.equal(row.status,'qa_done');assert.equal(row.description,undefined);
  assert.deepEqual(plain(row.acceptance_criteria),[]);assert.deepEqual(plain(row.linked_test_cases),['TC_3']);
  assert.throws(()=>validateStoryImportMetadata([{title:'Story',status:'invented'}],metadata),/not available/);
});
