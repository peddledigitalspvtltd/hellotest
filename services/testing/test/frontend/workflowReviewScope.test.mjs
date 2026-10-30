import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../../frontend/lib/workflowReviewScope.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(exports);
const {parseWorkflowReviewScope}=exports;

test('review links retain an exact deduplicated Library ID filter',()=>{
  assert.equal(parseWorkflowReviewScope(null),null);
  assert.deepEqual(parseWorkflowReviewScope(' case-a,case-b,case-a '),{ids:['case-a','case-b']});
  assert.equal(parseWorkflowReviewScope(Array.from({length:200},(_,i)=>'case-'+i).join(',')).ids.length,200);
});

test('empty, oversized and malformed review scopes fail closed instead of opening the complete Library',()=>{
  for(const input of ['',',,,','bad\nrecord','x'.repeat(256),Array.from({length:201},(_,i)=>'case-'+i).join(',')]){
    const result=parseWorkflowReviewScope(input);
    assert.deepEqual(result.ids,[]);assert.match(result.error,/invalid/);
  }
});
