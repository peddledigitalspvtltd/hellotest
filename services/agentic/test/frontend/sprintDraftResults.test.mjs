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
  assert.deepEqual(results[0].automationTargets[0],{nodeId:'build',storyIndex:0,iterationPath:['each',0]});
  assert.deepEqual(results[1].automationTargets[0],{nodeId:'build',storyIndex:0});
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
  assert.deepEqual(results[0].automationTargets[0],{nodeId:'build',storyIndex:1});
  assert.deepEqual(results[0].manualTargets[0],{nodeId:'build',storyIndex:1});
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
  assert.equal(results[0].manualTargets[0],undefined);
  assert.equal(results[0].automationTargets[0],undefined);
});

test('legacy saved cumulative results remain reviewable and Story revisions never mix', () => {
  const row={...story('a'),cases:[draft('a')],case_assurance:[assessment('a')],automation:[{client_id:'case-a',case_index:0}]};
  const results=collectSprintDrafts({node_results:[stage('legacy',[row]),stage('new-revision',[{...story('a'),story_revision:'r2',cases:[draft('a2')]}])]});
  assert.equal(results.length,2);
  assert.equal(results[0].packet.automation[0].client_id,'case-a');
  assert.equal(results[1].packet.case_assurance,undefined);
  assert.deepEqual(results[0].automationTargets[0],{nodeId:'legacy',storyIndex:0});
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
  assert.deepEqual(result.packet.automation_failures.filter(Boolean),[failure]);assert.deepEqual(result.packet.automation_progress,progress);
  assert.deepEqual(result.packet.automation_input_required,[]);
  assert.deepEqual(result.manualTargets[0],{nodeId:'assess',storyIndex:0});
  assert.equal(result.automationTargets[0],undefined,'An active progress record does not become a completed acceptance target');
  assert.deepEqual(result.packet.cases.map(item=>item.client_id),['case-good','case-failed']);
});

test('nested case iterations merge automation and prepared test data by exact case identity',()=>{
  const cases=[draft('one'),draft('two')];
  const testData=client_id=>({status:'ready',source:'synthetic',parameter_values:{'t.department':'Fictional '+client_id}});
  const automation=client_id=>({client_id,case_fingerprint:'fingerprint-'+client_id,validation:{status:'passed'},executable:{code:'source '+client_id}});
  const caseRow=(index,client_id)=>({...story('sprint-story'),case_index:index,client_id,automation:[{...automation(client_id),case_index:index}],
    automation_failures:[],automation_input_required:[],test_data:testData(client_id)});
  const run={node_results:[
    stage('generate',[{...story('sprint-story'),cases}]),
    stage('assess',[{...story('sprint-story'),case_assurance:cases.map((item,index)=>({client_id:item.client_id,case_index:index,analysis:{},assurance_review:{summary:'Assessed '+item.client_id}}))}]),
    ...cases.map((item,index)=>({node_id:'automation-engineer',node_type:'artifactTask',status:'completed',iteration_path:['each-story',0,'each-test-case',index],output:{data:[caseRow(index,item.client_id)]}}))
  ]};
  const result=collectSprintDrafts(run)[0];
  assert.deepEqual(result.packet.automation.map(item=>item.executable.code),['source case-one','source case-two']);
  assert.deepEqual(result.packet.test_data.map(item=>item.parameter_values),[
    {'t.department':'Fictional case-one'},{'t.department':'Fictional case-two'}
  ]);
  assert.deepEqual(result.automationTargets,[0,1].map(index=>({nodeId:'automation-engineer',storyIndex:0,iterationPath:['each-story',0,'each-test-case',index]})));
  assert.deepEqual(result.manualTargets,result.automationTargets);
});

test('v4 case-scoped assurance and prepared data are visible before automation starts',()=>{
  const cases=[draft('one'),draft('two')];
  const scoped=(index,fields)=>({...story('a'),case_index:index,client_id:cases[index].client_id,...fields});
  const review=index=>({...assessment(index===0?'one':'two'),case_index:undefined,verification:{status:'passed'}});
  const prepared={status:'ready',source:'synthetic',parameter_values:{'t.product_code':'9000017248','t.expected_price':'353'}};
  const run={node_results:[stage('generate',[{...story('a'),cases}]),
    ...cases.map((_,index)=>({...stage('assess',[scoped(index,{case_assurance:review(index)})]),iteration_path:['each-story',0,'each-test-case',index]})),
    {...stage('prepare',[scoped(1,{test_data:prepared})]),iteration_path:['each-story',0,'each-test-case',1]}
  ]};
  const result=collectSprintDrafts(run)[0];
  assert.deepEqual(result.packet.case_assurance.map(item=>item.client_id),['case-one','case-two']);
  assert.deepEqual(result.packet.test_data[1],prepared);
  assert.equal(result.packet.automation,undefined);
  assert.deepEqual(result.manualTargets,[0,1].map(index=>({nodeId:'assess',storyIndex:0,iterationPath:['each-story',0,'each-test-case',index]})));
});

test('a failed later case retains saved cases, completed assessments, prepared data and active build progress',()=>{
  const cases=[draft('one'),draft('two')];
  const scoped=(index,fields)=>({...story('a'),case_index:index,client_id:cases[index].client_id,...fields});
  const receipt={id:'saved-one',kind:'manual',saved:true,story_id:'a',case_index:0,client_id:'case-one'};
  const run={node_results:[{...stage('generate',[{...story('a'),cases}]),output:{data:[{...story('a'),cases}],library_publication:{mode:'automatic',receipts:[receipt]}}},
    stage('assess',[scoped(0,{case_assurance:{...assessment('one'),verification:{status:'passed'}}})]),
    stage('prepare',[scoped(0,{test_data:{status:'ready',source:'dataset',parameter_values:{'t.product_code':'9000017248'}}})]),
    stage('build',[scoped(0,{automation:[{client_id:'case-one',case_index:0,executable:{code:'validated source'}}],automation_failures:[],automation_input_required:[]})]),
    {node_id:'assess',node_type:'artifactTask',status:'failed',progress:{completed_items:[scoped(1,{case_assurance:{...assessment('two'),case_index:undefined,verification:{status:'needs_input',limitations:['The model review did not complete.']},failure:{code:'AI_OUTPUT_TRUNCATED',message:'The model review did not complete.'}}})]}},
    {node_id:'prepare',node_type:'artifactTask',status:'running',progress:{completed_items:[scoped(1,{test_data:{status:'needs_input',source:'synthetic',parameter_values:{},message:'Review this case before preparing data.'}})]}},
    {node_id:'build',node_type:'artifactTask',status:'running',progress:{completed_items:[scoped(1,{automation_progress:{processed:0,total:1,active_case_index:1,active_phase:'automation.agent.case.started',active_message:'Generating second case'}})]}}
  ]};
  const result=collectSprintDrafts(run)[0];
  assert.deepEqual(savedSprintCaseIds(run),['saved-one']);
  assert.deepEqual(result.packet.cases,cases);
  assert.equal(result.packet.case_assurance[0].verification.status,'passed');
  assert.equal(result.packet.case_assurance_failures[1].code,'AI_OUTPUT_TRUNCATED');
  assert.equal(result.packet.test_data[0].parameter_values['t.product_code'],'9000017248');
  assert.equal(result.packet.test_data[1].message,'Review this case before preparing data.');
  assert.equal(result.packet.automation[0].executable.code,'validated source');
  assert.deepEqual(result.packet.automation_progress,{completed:1,failed:0,needs_input:0,processed:1,total:2,active_case_index:1,active_phase:'automation.agent.case.started',active_message:'Generating second case'});
  assert.deepEqual(result.automationTargets[0],{nodeId:'build',storyIndex:0},'Active progress does not become a new acceptance checkpoint');
});

test('foreign or stale case-scoped review, data and progress cannot attach to another generated case',()=>{
  const generated=stage('generate',[{...story('a'),cases:[draft('new')]}]);
  for(const identity of [{case_index:0,client_id:'case-old'},{case_index:1,client_id:'case-new'},{case_index:0}]) {
    const result=collectSprintDrafts({node_results:[generated,stage('stale',[{...story('a'),...identity,
      case_assurance:assessment('new'),test_data:{status:'ready',source:'synthetic',parameter_values:{'t.product':'wrong case'}},
      automation_progress:{processed:0,total:1,active_message:'wrong case'}}])]} )[0];
    assert.equal(result.packet.case_assurance,undefined);
    assert.equal(result.packet.test_data,undefined);
    assert.equal(result.packet.automation_progress,undefined);
  }
});

test('legacy assurance failures remain visible and a corrected review clears only its own failure',()=>{
  const failure=(index,id)=>({case_index:index,client_id:'case-'+id,code:'AI_INVALID_JSON',message:'Review '+id+' needs retry'});
  const results=collectSprintDrafts({node_results:[stage('generate',[{...story('a'),cases:[draft('one'),draft('two')]}]),
    stage('failed-assess',[{...story('a'),case_assurance_failures:[failure(0,'one'),failure(1,'two')]}]),
    stage('corrected',[{...story('a'),case_index:1,client_id:'case-two',case_assurance:{...assessment('two'),case_index:undefined,verification:{status:'passed'}}}])
  ]});
  assert.equal(results[0].packet.case_assurance_failures[0].message,'Review one needs retry');
  assert.equal(results[0].packet.case_assurance_failures[1],null);
});

test('case-scoped automation retries clear stale outcomes and preserve other cases',()=>{
  const cases=[draft('one'),draft('two')], row=(index,fields)=>({...story('a'),case_index:index,client_id:cases[index].client_id,...fields});
  const result=collectSprintDrafts({node_results:[stage('generate',[{...story('a'),cases}]),
    stage('blocked',[row(0,{automation:[null],automation_input_required:[{case_index:0,message:'Missing fixture'}],automation_failures:[]})]),
    stage('failed',[row(1,{automation:[null],automation_input_required:[],automation_failures:[{case_index:1,client_id:'case-two',message:'Build incomplete'}]})]),
    stage('repaired',[row(1,{automation:[{case_index:1,client_id:'case-two',executable:{code:'validated source'}}],automation_input_required:[],automation_failures:[]})])
  ]})[0];
  assert.equal(result.packet.automation_failures[1],null);
  assert.equal(result.packet.automation_input_required[0].message,'Missing fixture');
  assert.deepEqual(result.packet.automation_progress,{completed:1,failed:0,needs_input:1,processed:2,total:2});
});

test('terminal automation failure uses its exact public case identity and retains manual publication and prepared data',()=>{
  const message='AI context exceeds this feature’s input budget.';
  const path=['each-story',0,'each-test-case',0];
  const row={...story('a'),case_index:0,client_id:'case-one',automation_progress:{processed:0,total:1,active_case_index:0,active_phase:'automation.agent.browser.failed'}};
  const run={node_results:[{...stage('generate',[{...story('a'),cases:[draft('one')]}]),output:{data:[{...story('a'),cases:[draft('one')]}],
    library_publication:{receipts:[{id:'saved-manual',kind:'manual',saved:true,story_id:'a',case_index:0,client_id:'case-one'}]}}},
    stage('prepare',[{...story('a'),case_index:0,client_id:'case-one',test_data:{status:'ready',source:'synthetic',existing_parameter_count:11,model_calls_attempted:0,parameter_values:{}}}]),
    {node_id:'build',node_type:'artifactTask',status:'failed',error:message,iteration_path:path,progress:{completed_items:[row]},logs:[{
      event:'node_failed',origin:{node_id:'build',iteration_path:path},code:'AI_INPUT_BUDGET_EXCEEDED',message,
      outcome_unknown:true,reconciliation_required:true,model_candidate:'Private provider body must stay private'
    }]}
  ]};
  const packet=collectSprintDrafts(run)[0].packet;
  assert.deepEqual(packet.automation_failures,[{case_index:0,client_id:'case-one',message,code:'AI_INPUT_BUDGET_EXCEEDED',outcome_unknown:true,reconciliation_required:true}]);
  assert.equal(packet.automation_progress.failed,1);
  assert.equal(packet.automation_progress.completed,0);
  assert.equal(packet.automation_progress.processed,1);
  assert.equal(packet.test_data[0].existing_parameter_count,11);
  assert.equal(packet.test_data[0].model_calls_attempted,0);
  assert.deepEqual(packet.cases,[draft('one')]);
  assert.deepEqual(savedSprintCaseIds(run),['saved-manual']);
  assert.doesNotMatch(JSON.stringify(packet),/Private provider body/);
});

test('publication failure after a completed build preserves one draft without inventing a generation failure',()=>{
  const path=['each-story',0,'each-test-case',0];
  const automation={case_index:0,client_id:'case-one',validation:{status:'passed'},verification_status:'unverified',executable:{code:'validated source'}};
  const row={...story('a'),case_index:0,client_id:'case-one',automation:[automation],automation_failures:[],automation_input_required:[],
    automation_progress:{completed:1,failed:0,needs_input:0,processed:1,total:1}};
  const failure={code:'DATABASE_UNAVAILABLE',message:'Automatic Library publication could not save the automation draft.'};
  const build={node_id:'build',node_type:'artifactTask',status:'failed',iteration_path:path,error:failure.message,error_details:failure,
    output:{data:[row]},progress:{completed_items:[row]},logs:[{event:'node_failed',origin:{node_id:'build',iteration_path:path},...failure}]};
  const run={node_results:[stage('generate',[{...story('a'),cases:[draft('one')]}]),build]};
  const result=collectSprintDrafts(run)[0];
  assert.deepEqual(result.packet.automation,[automation]);
  assert.equal(result.packet.automation_failures.filter(Boolean).length,0);
  assert.deepEqual(result.packet.automation_progress,{completed:1,failed:0,needs_input:0,processed:1,total:1});
  assert.equal(result.automationTargets[0],undefined,'A publication failure cannot become an acceptance checkpoint.');
  assert.deepEqual(build.error_details,failure,'The node inspector retains the publication failure diagnostics.');
  assert.equal(build.status,'failed');
});

test('terminal failures without matching explicit case identity cannot become inferred per-case failures',()=>{
  const message='Provider unavailable.';
  for(const row of [story('a'),{...story('a'),case_index:0},{...story('a'),case_index:0,client_id:'case-old'},{...story('a'),case_index:1,client_id:'case-one'}]) {
    const result=collectSprintDrafts({node_results:[stage('generate',[{...story('a'),cases:[draft('one')]}]),
      {node_id:'build',node_type:'artifactTask',status:'failed',error:message,progress:{completed_items:[{...row,automation_progress:{processed:0,total:1}}]}}
    ]})[0];
    assert.equal(result.packet.automation_failures,undefined);
  }
  const result=collectSprintDrafts({node_results:[stage('generate',[{...story('a'),cases:[draft('one')]}]),
    {node_id:'build',node_type:'artifactTask',status:'failed',error:message,iteration_path:['each',1],
      progress:{completed_items:[{...story('a'),case_index:0,client_id:'case-one',automation_progress:{processed:0,total:1}}]},
      logs:[{event:'node_failed',origin:{node_id:'build',iteration_path:['each',0]},code:'OTHER_ITERATION',message,outcome_unknown:true}]}
  ]})[0];
  assert.deepEqual(result.packet.automation_failures,[{case_index:0,client_id:'case-one',message}], 'Unrelated diagnostics cannot supply an invented code or reconciliation flag');
});
