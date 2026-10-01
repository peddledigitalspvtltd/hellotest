import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const load = url => {
  const exports = {};
  new Function('exports','require',ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,()=>load(new URL('../../../platform/frontend/src/shared/lib/csvGrid.ts',import.meta.url)));
  return exports;
};
const {parseIssueCsv,buildIssueImportTemplate}=load(new URL('../../frontend/lib/issueImport.ts',import.meta.url));
const csv = record => { const cell = value => '"'+String(typeof value==='object'?JSON.stringify(value):value??'').replaceAll('"','""')+'"'; return Object.keys(record).map(cell).join(',')+'\r\n'+Object.values(record).map(cell).join(','); };
test('bug template roundtrips Windows CSV and quoted multiline details without losing labels or false booleans',()=>{
  const template=buildIssueImportTemplate()[0];
  const [row]=parseIssueCsv('\uFEFF'+csv(template));
  assert.equal(row.title,template.Title); assert.equal(row.steps_to_reproduce,template['Steps to reproduce']);
  assert.deepEqual(row.labels,['checkout','payment']); assert.equal(row.regression,false);
  assert.equal(row.user_id,undefined);
});
test('CSV import refuses silent column loss, missing descriptions, malformed quotes and shifted rows',()=>{
  for (const [input,pattern] of [
    ['Title,Description\nGood,',/Row 2.*Description/],['Title,Description\nGood,Details,Extra',/Row 2.*cells/],
    ['Title,Summary,Description\nGood,Good,Details',/duplicate columns/],['Title,Description,Unknown\nGood,Details,x',/Unsupported columns/],
    ['Title,Description\nGood,"unfinished',/closing quote/], [csv({Title:'Valid',Description:'Details',Regression:'maybe'}),/Regression/],
    [csv({Title:'Valid',Description:'Details',Labels:'[broken]'}),/Labels/]
  ]) assert.throws(()=>parseIssueCsv(input),pattern);
});
