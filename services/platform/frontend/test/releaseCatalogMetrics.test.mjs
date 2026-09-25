import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const load = name => {
  const exports = {};
  const source = readFileSync(sourceFile(name + '.ts', "lib"),'utf8');
  new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(dependency=>load(dependency.replace('./','')),exports);
  return exports;
};
const {releaseStoryCompletion,releasePortfolioCompletion,releaseLifecycleCounts,releasePortfolioHealth} = load('releaseCatalogMetrics');
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
  const inaccessible={requirements:[],requirement_count:null,story_scope_visible:false};
  assert.equal(releaseStoryCompletion(inaccessible,'qa').percent,null);
  assert.equal(releaseStoryCompletion(inaccessible,'dev').percent,null);
  assert.equal(releasePortfolioCompletion([inaccessible]).percent,null,'hidden Story scope is not an empty completed backlog');
});

test('duplicate membership rows cannot inflate scope, and empty scope remains empty',()=>{
  assert.deepEqual(releaseStoryCompletion({requirements:[story('same','accepted'),story('same','accepted')],requirement_count:1}),{completed:1,total:1,percent:100});
  assert.deepEqual(releasePortfolioCompletion([]),{completed:0,incomplete:0,percent:0,total:0});
});

test('completion uses the same normalized delivery aliases as Story and Sprint SQL',()=>{
  const aliases=['QA-Done',' QA   Done ','qa__done','CLOSED','resolved','accepted','Completed'];
  const result=releaseStoryCompletion(release(aliases.map((status,index)=>story(String(index),status))));
  assert.equal(result.completed,aliases.length);
  assert.equal(result.percent,100);
  assert.equal(releaseStoryCompletion(release([story('dev','Dev-Done')])).percent,0);
});

test('an overdue active Release remains in progress and completed Releases stay outside overdue counts',()=>{
  assert.deepEqual(releaseLifecycleCounts([
    {persisted_state:'in_progress',state:'overdue'},
    {persisted_state:'in_progress',state:'in_progress'},
    {persisted_state:'planned',state:'overdue'},
    {persisted_state:'released',state:'released'}
  ]),{total:4,planned:1,inProgress:2,overdue:2});
});

test('Dev and QA completion use cumulative workflow milestones with one shared denominator',()=>{
  const rows = ['dev_ready','dev_in_progress','dev_blocked','Dev Done','QA Ready','qa_in_progress','qa-blocked','QA Done','Closed','ready'];
  const scope = release(rows.map((status,index)=>story(String(index),status)));
  assert.deepEqual(releaseStoryCompletion(scope,'dev'),{completed:6,total:10,percent:60});
  assert.deepEqual(releaseStoryCompletion(scope,'qa'),{completed:2,total:10,percent:20});
  assert.equal(releaseStoryCompletion({...scope,requirement_count:20},'dev').percent,null);
});

test('portfolio health gives each metric its exact Release set without double-counting overlapping risks',()=>{
  const scope = [
    {id:'both',persisted_state:'in_progress',state:'overdue'},
    {id:'quality',persisted_state:'planned',state:'planned'},
    {id:'ready',persisted_state:'released',state:'released'},
    {id:'empty',persisted_state:'planned',state:'planned'},
    {id:'released-risk',persisted_state:'released',state:'released'}
  ];
  const evidence = new Map([
    ['both',{total_stories:2,readiness_state:'at_risk'}],
    ['quality',{total_stories:1,readiness_state:'not_ready'}],
    ['ready',{total_stories:1,readiness_state:'ready'}],
    ['empty',{total_stories:0,readiness_state:'ready'}],
    ['released-risk',{total_stories:1,readiness_state:'not_ready'}],
    ['other-project',{total_stories:1,readiness_state:'ready'}]
  ]);
  const result = releasePortfolioHealth([...scope,scope[0]],evidence);
  assert.equal(result.scope.length,5,'Duplicate Release responses do not inflate counts');
  assert.deepEqual(result.ready.map(item=>item.id),['ready'],'Empty scopes and evidence outside this project catalog are excluded');
  assert.deepEqual(result.atRisk.map(item=>item.id),['both','quality'],'A Release overdue and below quality policy is counted once');
  assert.deepEqual(result.overdue.map(item=>item.id),['both']);
  assert.deepEqual(result.missingEvidence,[]);
});

test('missing quality evidence stays identifiable while schedule evidence remains available',()=>{
  const scope=[{id:'missing',persisted_state:'planned',state:'planned'},{id:'late',persisted_state:'in_progress',state:'overdue'}];
  const result=releasePortfolioHealth(scope,new Map());
  assert.deepEqual(result.missingEvidence.map(item=>item.id),['missing','late']);
  assert.deepEqual(result.ready,[]);
  assert.deepEqual(result.atRisk.map(item=>item.id),['late'],'Unknown quality is not classified as a failed assessment');
  assert.deepEqual(result.overdue.map(item=>item.id),['late']);
  assert.deepEqual(releasePortfolioHealth([],new Map()),{scope:[],ready:[],atRisk:[],overdue:[],missingEvidence:[]});
});
