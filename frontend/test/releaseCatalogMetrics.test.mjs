import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const load = name => {
  const exports = {};
  const source = readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8');
  new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(dependency=>load(dependency.replace('./','')),exports);
  return exports;
};
const {releaseStoryCompletion,releasePortfolioCompletion} = load('releaseCatalogMetrics');
const story = (id,status='open',updated_at='2026-09-01') => ({id,status,updated_at});
const release = stories => ({requirements:stories,requirement_count:stories.length});

test('portfolio Story completion counts a shared Story once, using its latest state',()=>{
  const first = release([story('shared','done'),story('other')]);
  const second = release([story('shared','open','2026-08-01'),story('last','qa_done')]);
  assert.deepEqual(releasePortfolioCompletion([first,second]),{completed:2,incomplete:1,percent:67,total:3});
  assert.equal(releaseStoryCompletion(first).percent,50);
});

test('partial release scope cannot manufacture a completion percentage',()=>{
  const partial = {...release([story('done','done')]),requirement_count:25};
  assert.deepEqual(releaseStoryCompletion(partial),{completed:1,total:25,percent:null});
  assert.equal(releasePortfolioCompletion([partial]).percent,null);
});

test('duplicate membership rows cannot inflate scope, and empty scope remains empty',()=>{
  assert.deepEqual(releaseStoryCompletion({requirements:[story('same','accepted'),story('same','accepted')],requirement_count:1}),{completed:1,total:1,percent:100});
  assert.deepEqual(releasePortfolioCompletion([]),{completed:0,incomplete:0,percent:0,total:0});
});
