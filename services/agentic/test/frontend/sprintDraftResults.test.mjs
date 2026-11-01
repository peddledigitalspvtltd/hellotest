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
const { collectSprintDrafts, savedSprintCaseIds, sprintReviewLinks } = module;
const stage = (id, data) => ({node_id:id,node_type:'artifactTask',status:'completed',output:{data}});
const story = id => ({story_id:id,story_revision:'r1',story:{title:'Story '+id}});
const draft = id => ({client_id:'case-'+id,title:'Case '+id});
const assessment = id => ({client_id:'case-'+id,case_index:0,analysis:{},assurance_review:{summary:'Reviewed '+id}});

test('connected foreach results retain every Story, publication receipt and exact historical acceptance target', () => {
  const row = (id, task) => ({...story(id), ...(task === 'generate' ? {cases:[draft(id)]} : task === 'assess' ? {case_assurance:[assessment(id)]} : {automation:[{client_id:'case-'+id,case_index:0}]})});
  const run = {node_results:['generate','assess','build'].map(task => ({...stage(task,[row('b',task)]), iterations:['a','b'].map((id,index) => ({
    status:'completed',iteration_path:['each',index],output:{data:[row(id,task)],library_publication:{mode:'automatic',receipts:task === 'generate' ? [{id:'saved-'+id,kind:'manual',saved:true,story_id:id,case_index:0,client_id:'case-'+id}] : []}}
  }))}))};
  const results = collectSprintDrafts(run);
  assert.deepEqual(results.map(result=>result.packet.story_id),['a','b']);
  assert.ok(results.every(result=>result.packet.case_assurance.length===1 && result.packet.automation.length===1));
  assert.deepEqual(results[0].automationTarget,{nodeId:'build',storyIndex:0,iterationPath:['each',0]});
  assert.deepEqual(results[1].automationTarget,{nodeId:'build',storyIndex:0});
  assert.deepEqual(savedSprintCaseIds(run),['saved-a','saved-b']);
  assert.deepEqual(savedSprintCaseIds(run,{},'generate'),['saved-a','saved-b']);
  run.node_results[2].status='failed';
  run.node_results[2].output=undefined;
  assert.equal(collectSprintDrafts(run)[0].packet.automation.length,1,'A later batch failure retains earlier successful automation');
});

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

test('Library review links contain only saved manual receipts, including partial publication and explicit acceptance', () => {
  const run={project_id:'project-a',app_type_id:'app-a',node_results:[
    {...stage('generated',[]),status:'failed',output:{library_publication:{mode:'automatic',status:'partial',receipts:[
      {id:'manual-a',kind:'manual',saved:true},{id:'automation-a',kind:'automation',saved:true},{id:'unsaved',kind:'manual',saved:false}
    ]}}},
    {...stage('retry',[]),output:{library_publication:{receipts:[{id:'manual-a',kind:'manual',saved:true}]}}}
  ]};
  const ids=savedSprintCaseIds(run,{'0:0:manual':'accepted-b','0:0:automation':'accepted-automation'});
  assert.deepEqual(ids,['manual-a','accepted-b']);
  const links=sprintReviewLinks(run,ids);
  assert.equal(links.length,1);
  const url=new URL(links[0].href,'https://app.example');
  assert.equal(url.pathname,'/test-cases');assert.equal(url.searchParams.get('project'),'project-a');
  assert.equal(url.searchParams.get('appType'),'app-a');assert.equal(url.searchParams.get('review_cases'),'manual-a,accepted-b');
  assert.equal(url.searchParams.has('case'),false,'Review opens the scoped Library, not one arbitrary draft');
});

test('large workflow review scopes use bounded batches without losing or duplicating cases', () => {
  const ids=Array.from({length:235},(_,i)=>'case-'+i);
  const links=sprintReviewLinks({project_id:'p',app_type_id:'a'},[...ids,ids[0]]);
  assert.deepEqual(links.map(link=>link.count),[100,100,35]);
  assert.deepEqual(links.flatMap(link=>new URL(link.href,'https://app.example').searchParams.get('review_cases').split(',')),ids);
  assert.deepEqual(sprintReviewLinks({project_id:'p'},[]),[]);
});

test('a generator Review action resolves only matching downstream Library receipts after reordered Stories',()=>{
  const generated=stage('generator',[{...story('a'),cases:[draft('a')]},{...story('b'),cases:[draft('b')]}]);
  const published=(id,rows,receipts)=>({...stage(id,rows),output:{data:rows,library_publication:{receipts}}});
  const run={node_results:[generated,
    published('assurance',[story('b'),story('a')],[
      {id:'saved-b',kind:'manual',saved:true,story_id:'b',case_index:0,client_id:'case-b'},
      {id:'saved-a',kind:'manual',saved:true,story_id:'a',case_index:0,client_id:'case-a'},
      {id:'unrelated',kind:'manual',saved:true,story_id:'other',case_index:0,client_id:'case-other'},
      {id:'different-draft',kind:'manual',saved:true,story_id:'a',case_index:0,client_id:'case-regenerated'}]),
    published('old-revision',[{...story('a'),story_revision:'r0'}],[{id:'old-case',kind:'manual',saved:true,story_id:'a',case_index:0,client_id:'case-a'}])
  ]};
  assert.deepEqual(savedSprintCaseIds(run,{},'generator'),['saved-b','saved-a']);
  assert.deepEqual(savedSprintCaseIds(run,{},'missing'),[]);
});

test('whole-case progress preserves completed drafts and separates failed cases from missing input',()=>{
  const failure={case_index:1,client_id:'case-failed',message:'The generated source did not preserve the amount assertion.',code:'AUTOMATION_GENERATED_SOURCE_INVALID'};
  const progress={completed:1,failed:1,needs_input:0,processed:2,total:2};
  const data=[{...story('a'),automation:[{client_id:'case-good',case_index:0,executable:{code:'validated complete source'}},null],automation_failures:[failure],automation_progress:progress}];
  const run={node_results:[stage('generate',[{...story('a'),cases:[draft('good'),draft('failed')]}]),
    stage('assess',[{...story('a'),case_assurance:[assessment('good'),{...assessment('failed'),case_index:1}]}]),
    {node_id:'build',node_type:'artifactTask',status:'running',progress:{completed_items:data,automation_checkpoint:{stories:[{cases:[draft('private-checkpoint')]}]}}}]};
  const result=collectSprintDrafts(run)[0];
  assert.equal(result.packet.automation[0].executable.code,'validated complete source');
  assert.deepEqual(result.packet.automation_failures,[failure]);assert.deepEqual(result.packet.automation_progress,progress);
  assert.deepEqual(result.packet.automation_input_required,[]);
  assert.deepEqual(result.manualTarget,{nodeId:'assess',storyIndex:0});
  assert.equal(result.automationTarget,undefined,'An active progress record does not become a completed acceptance target');
  assert.deepEqual(result.packet.cases.map(item=>item.client_id),['case-good','case-failed']);
});
