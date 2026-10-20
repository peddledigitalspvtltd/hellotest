const test=require('node:test');
const assert=require('node:assert/strict');
const {createUsedObjectService,MIME,sourceFingerprint}=require('../../backend/services/automationUsedObjects.service');
const {recordBrowserOperation}=require('../../backend/lib/automationBrowserRecording');
const {projectModelSnapshot}=require('../../backend/lib/automationBrowserModelTargets');
const {createRecordedSectionContract}=require('../../backend/lib/automationRecordedContract');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {sameRecordedLocator}=require('../../backend/lib/automationLocatorIdentity');

const receipt=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});
const testCase={id:'case',project_id:'project',app_type_id:'app'};
const step={id:'step',test_case_id:'case',action:'Enter the configured email',expected_result:'The configured value is retained'};
function recorded({cloneSnapshot=false,failed=false,manual=false,assertionUrl,assertionLocator='#email',pageUrl='https://app.test/login'}={}){
  const snapshot={tool:'browser_snapshot',result:receipt({observation_id:'observed-login',url:pageUrl,title:'Login',elements:[
    {tag:'input',accessible_role:'textbox',accessible_name:'Email',attributes:{value:'DO_NOT_SAVE_INPUT'},locators_validated:true,locator_candidates:[...new Set(['#email',assertionLocator])]},
    {tag:'button',accessible_role:'button',accessible_name:'Unused',locators_validated:true,locator_candidates:['#unused']}
  ]})};
  projectModelSnapshot(snapshot);
  const requests=[{name:'browser_fill',arguments:{locator:'#email',value:'@r.email'}},{name:'browser_assert',arguments:{locator:assertionLocator,assertion:'value',value:'@r.email'}}];
  const observations=requests.map((request,index)=>{
    const observation={tool:request.name,execution_step_id:step.id,action_id:'operation-'+index,result:receipt(failed?{action_outcome:'not_attempted'}:index?{assertion_outcome:'satisfied',...(assertionUrl?{url:assertionUrl}:{})}:{action_outcome:'completed'})};
    recordBrowserOperation(observation,request,{snapshot:cloneSnapshot?structuredClone(snapshot):snapshot});return observation;
  });
  const source=compileRecordedProgram(requests).source;
  const obligations=[{id:step.id,source:'section',action:step.action,expected_result:step.expected_result},...(manual?[{id:'manual-original',source:'manual',manual_test_case_id:'manual-case',manual_step_id:'manual-step',action:'Enter @r.email',expected_result:'The email value is retained'}]:[])];
  const seal=createRecordedSectionContract({execution:{required:true,step_id:step.id,action:step.action,expected_result:step.expected_result,obligations},requests,source,mappings:obligations.map(row=>({id:row.id,action_operations:[1],assertion_operations:[2]}))});
  return {source,seal,browserObservations:observations};
}

function fixture(){
  const state={artifacts:[],entries:[],source:'',project:'project',app:'app',allow:true,checks:0,failEntry:false,failReceipt:false,abortAfterEntry:false,stageWrites:0};
  const activity={id:'activity',project_id:'project',app_type_id:'app',category:'automation_build',created_by:'user'};
  const controller=new AbortController();
  const executionGuard={signal:controller.signal,ensureOwnership:async()=>{state.checks++;}};
  const transaction=callback=>async()=>{const before=structuredClone({artifacts:state.artifacts,entries:state.entries});try{return await callback();}catch(error){state.artifacts=before.artifacts;state.entries=before.entries;throw error;}};
  const transactions={getTransaction:async id=>{assert.equal(id,'activity');return {...activity};},listTransactionArtifacts:async()=>structuredClone(state.artifacts),
    getTransactionArtifact:async id=>structuredClone(state.artifacts.find(row=>row.id===id)),
    createTransactionArtifact:async(id,input)=>{state.stageWrites++;const row={id:'artifact-'+(state.artifacts.length+1),transaction_id:id,...input};state.artifacts.push(row);return {...row};}};
  const db={transaction:callback=>async()=>callback(),prepare:sql=>({get:async()=>sql.includes('FROM test_cases')?{id:'case',project_id:state.project,app_type_id:state.app,automation_start_url:state.startUrl??null}:{id:'step',test_case_id:'case',automation_code:state.source},all:async()=>structuredClone(state.contextSteps||[{...step,automation_code:state.source}])})};
  const obsDb={transaction,prepare:sql=>({get:async()=>({}),all:async()=>structuredClone(sql.includes('FROM automation_learning_cache')?state.entries:state.artifacts),run:async(content,id)=>{if(state.failReceipt)throw new Error('receipt database unavailable');state.artifacts.find(row=>row.id===id).content=content;return {changes:1};}})};
  const repository={
    getLearningCacheEntry:async id=>structuredClone(state.entries.find(row=>row.id===id)),
    findDuplicateLearningCacheEntry:async input=>structuredClone(state.entries.find(row=>row.project_id===input.project_id&&row.app_type_id===input.app_type_id&&sameRecordedLocator(row.locator,input.locator)&&row.metadata.screen_name===input.screen_name)),
    createLearningCacheEntry:async input=>{
      if(state.failEntry&&input.locator!=='__screen__')throw new Error('field database unavailable');
      const prior=state.entries.find(row=>row.page_url===input.page_url&&row.locator===input.locator&&(row.metadata?.observed_route_sha256||null)===(input.metadata?.observed_route_sha256||null));
      if(prior)return structuredClone(prior);
      const row={...input,id:'entry-'+(state.entries.length+1),page_key:input.screen_name,locator_intent:input.object_name||input.locator_intent,metadata:{...input.metadata,screen_name:input.screen_name,object_name:input.object_name}};
      state.entries.push(row);
      if(state.abortAfterEntry&&row.locator!=='__screen__')controller.abort(new DOMException('The operation was aborted','AbortError'));
      return structuredClone(row);
    },
    updateLearningCacheEntry:async(id,patch)=>{const row=state.entries.find(row=>row.id===id);row.metadata={...row.metadata,...patch.metadata};return structuredClone(row);}
  };
  const service=createUsedObjectService({db,obsDb,transactions,repository,getAccess:async()=>({'automation.repository.manage':state.allow})});
  const input={testCase,step,transactionId:'activity',userId:'user',executionGuard,assertAccess:async()=>{}};
  return {state,activity,service,input,repository};
}

test('staging records only confirmed used objects, excludes values and is idempotent without creating repository entries',async()=>{
  const {state,service,input}=fixture();
  const candidate=recorded({pageUrl:'https://app.test/login?secret=DO_NOT_SAVE_QUERY'}),first=await service.stage({...input,...candidate}),second=await service.stage({...input,...candidate});
  assert.deepEqual(first,second);assert.equal(state.stageWrites,1);assert.equal(state.entries.length,0);
  const manifest=JSON.parse(state.artifacts[0].content);
  assert.equal(manifest.source_sha256,sourceFingerprint(candidate.source));assert.equal(manifest.targets.length,1);
  assert.deepEqual(manifest.targets[0].operation_indexes,[1,2]);assert.equal(manifest.targets[0].page_url,'https://app.test/login');
  assert.doesNotMatch(state.artifacts[0].content,/DO_NOT_SAVE|#unused|@r\.email|automation_code|value/);
});

test('equivalent confirmed selectors share one staged object with every instruction usage',async()=>{
 const {state,service,input}=fixture(),candidate=recorded({assertionLocator:'locator("#email")'});
 const pending=await service.stage({...input,...candidate});state.source=candidate.source;
 const manifest=JSON.parse(state.artifacts[0].content);
 assert.equal(manifest.targets.length,1);assert.deepEqual(manifest.targets[0].operation_indexes,[1,2]);
 const result=await service.sync({...input,artifactId:pending.artifact_id});
 assert.equal(state.entries.length,2);assert.equal(result.bindings.length,1);
 assert.deepEqual(result.bindings[0].operation_indexes,[1,2]);
});

test('copied snapshots cannot issue target provenance and failed operations cannot match the sealed Plan',async()=>{
  const {state,service,input}=fixture();
  assert.equal(await service.stage({...input,...recorded({cloneSnapshot:true})}),null);
  await assert.rejects(service.stage({...input,...recorded({failed:true})}),{code:'AUTOMATION_OBJECT_RECORDING_CHANGED'});
  assert.equal(state.artifacts.length,0);assert.equal(state.entries.length,0);
});

test('staging rejects changed source, forged seals, changed section requirements and foreign transaction scope',async()=>{
  const {state,service,input,activity}=fixture(),candidate=recorded();
  await assert.rejects(service.stage({...input,...candidate,source:candidate.source+'\n'}),{code:'AUTOMATION_RECORDED_CONTRACT_INVALID'});
  await assert.rejects(service.stage({...input,...candidate,seal:structuredClone(candidate.seal)}),{code:'AUTOMATION_RECORDED_CONTRACT_INVALID'});
  await assert.rejects(service.stage({...input,...candidate,step:{...step,expected_result:'Changed expectation'}}),{code:'AUTOMATION_RECORDED_CONTRACT_INVALID'});
  activity.project_id='foreign';await assert.rejects(service.stage({...input,...candidate}),{code:'AUTOMATION_OBJECT_SCOPE_CHANGED'});
  assert.equal(state.artifacts.length,0);
});

test('an uncommitted or edited Plan source cannot create repository objects',async()=>{
  const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});
  assert.equal((await service.sync({...input,artifactId:pending.artifact_id})).status,'source_changed');
  state.source=candidate.source+'\n// a concurrent manual edit';
  assert.equal((await service.sync({...input,artifactId:pending.artifact_id})).status,'source_changed');
  assert.equal(state.entries.length,0);assert.equal(JSON.parse(state.artifacts[0].content).status,'pending');
});

test('a saved section creates its screen and exact field immediately and links both used instruction ordinals',async()=>{
  const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;
  const result=await service.sync({...input,artifactId:pending.artifact_id});
  assert.equal(result.status,'synced');assert.equal(result.object_count,1);assert.equal(state.entries.length,2);
  const field=state.entries.find(row=>row.locator==='#email');
  assert.equal(field.metadata.screen_entry_id,state.entries.find(row=>row.locator==='__screen__').id);
  assert.deepEqual(field.metadata.instruction_usages,[{test_case_id:'case',step_id:'step',source_sha256:sourceFingerprint(candidate.source),operation_indexes:[1,2]}]);
  assert.deepEqual(result.bindings,[{entry_id:field.id,reference:'login.Email',operation_indexes:[1,2]}]);
  assert.deepEqual(await service.sync({...input,artifactId:pending.artifact_id}),result);assert.equal(state.entries.length,2);
  assert.equal(result.repository_rows[0].id,field.id);assert.doesNotMatch(JSON.stringify(result.repository_rows),/DO_NOT_SAVE|screen_dom|screenshot/);
});

test('repository failure rolls back all object writes and the pending artifact resumes after restart',async()=>{
  const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;state.failEntry=true;
  await assert.rejects(service.sync({...input,artifactId:pending.artifact_id}),/field database unavailable/);
  assert.equal(state.entries.length,0);assert.equal(JSON.parse(state.artifacts[0].content).status,'pending');
  state.failEntry=false;assert.deepEqual(await service.resume(input),{synced:1,pending:0});assert.equal(state.entries.length,2);
});

test('a failed sync receipt rolls back repository writes and cancellation cannot leave partial objects',async()=>{
  for(const scenario of ['failReceipt','abortAfterEntry']){
    const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;state[scenario]=true;
    await assert.rejects(service.sync({...input,artifactId:pending.artifact_id}),scenario==='failReceipt'?/receipt database unavailable/:{name:'AbortError'});
    assert.equal(state.entries.length,0);assert.equal(JSON.parse(state.artifacts[0].content).status,'pending');
  }
});

test('repository permissions and the latest project/application are rechecked before any object write',async()=>{
  const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;state.allow=false;
  assert.equal((await service.sync({...input,artifactId:pending.artifact_id})).error_code,'AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED');assert.equal(state.entries.length,0);
  state.allow=true;state.app='foreign';await assert.rejects(service.sync({...input,artifactId:pending.artifact_id}),{code:'AUTOMATION_OBJECT_SCOPE_CHANGED'});assert.equal(state.entries.length,0);
});

test('existing curated fields retain their identity, names and locator while gaining instruction usage',async()=>{
  const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;
  state.entries.push({id:'saved-screen',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'SignIn',locator:'__screen__',metadata:{screen_name:'SignIn'}},
    {id:'saved-email',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'SignIn',locator:'#email',locator_intent:'CustomerEmail',metadata:{screen_name:'SignIn',object_name:'CustomerEmail',description:'Curated description'}});
  const result=await service.sync({...input,artifactId:pending.artifact_id});
  assert.equal(state.entries.length,2);assert.equal(result.bindings[0].entry_id,'saved-email');assert.equal(result.bindings[0].reference,'SignIn.CustomerEmail');
  assert.equal(state.entries[1].metadata.description,'Curated description');assert.equal(state.entries[1].locator,'#email');
});

test('a confirmed equivalent selector reuses the existing object without overwriting its curated spelling',async()=>{
 const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;
 state.entries.push({id:'saved-screen',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'SignIn',locator:'__screen__',metadata:{screen_name:'SignIn'}},
  {id:'saved-email',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'SignIn',locator:'locator("#email")',locator_intent:'CustomerEmail',metadata:{screen_name:'SignIn',object_name:'CustomerEmail'}});
 const result=await service.sync({...input,artifactId:pending.artifact_id});
 assert.equal(state.entries.length,2);assert.equal(result.bindings[0].entry_id,'saved-email');
 assert.equal(state.entries[1].locator,'locator("#email")');
 assert.deepEqual(await service.sync({...input,artifactId:pending.artifact_id}),result,'idempotent sync accepts the same exact native locator identity');
});

test('an edited repository locator is not silently reset by a retry of old instructions',async()=>{
  const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;
  state.entries.push({id:'saved-screen',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'SignIn',locator:'__screen__',metadata:{screen_name:'SignIn'}},
    {id:'reviewed-email',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'SignIn',locator:'#email-reviewed',locator_intent:'Email',metadata:{screen_name:'SignIn',object_name:'Email'}});
  const result=await service.sync({...input,artifactId:pending.artifact_id});
  assert.equal(state.entries.find(row=>row.id==='reviewed-email').locator,'#email-reviewed');
  assert.notEqual(result.bindings[0].entry_id,'reviewed-email');assert.equal(state.entries.find(row=>row.id===result.bindings[0].entry_id).locator,'#email');
});

test('linked manual requirements retain their exact seal identity and no private action data is persisted',async()=>{
 const {state,service,input}=fixture(),candidate=recorded({manual:true});
 const manualSpecification=[{manual_test_case_id:'manual-case',manual_step_id:'manual-step',action:'Enter @r.email',expected_result:'The email value is retained'}];
 await assert.rejects(service.stage({...input,...candidate,manualSpecification:[{...manualSpecification[0],action:'Enter different data'}]}),{code:'AUTOMATION_RECORDED_CONTRACT_INVALID'});
 const manifest=await service.stage({...input,...candidate,manualSpecification});assert.ok(manifest.artifact_id);
 assert.doesNotMatch(state.artifacts[0].content,/@r\.email|manual-case|manual-step|Enter|configured value/);
});

test('an assertion reporting a new page cannot bind an earlier snapshot field to the new page',async()=>{
 const {state,service,input}=fixture(),candidate=recorded({assertionUrl:'https://app.test/other'});
 await service.stage({...input,...candidate});
 const manifest=JSON.parse(state.artifacts[0].content);
 assert.equal(manifest.targets.length,1);assert.deepEqual(manifest.targets[0].operation_indexes,[1]);
 assert.equal(manifest.targets[0].page_url,'https://app.test/login');
});

test('permission revocation after a field write rolls back the whole repository transaction',async()=>{
 const {state,service,input,repository}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;
 const update=repository.updateLearningCacheEntry;repository.updateLearningCacheEntry=async(...args)=>{const result=await update(...args);state.allow=false;return result;};
 await assert.rejects(service.sync({...input,artifactId:pending.artifact_id}),{code:'AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED'});
 assert.equal(state.entries.length,0);assert.equal(JSON.parse(state.artifacts[0].content).status,'pending');
});

test('a previously synced receipt cannot claim new source or a changed repository locator is still bound',async()=>{
 const {state,service,input}=fixture(),candidate=recorded(),pending=await service.stage({...input,...candidate});state.source=candidate.source;
 await service.sync({...input,artifactId:pending.artifact_id});
 state.source=candidate.source+'\n// repaired source';assert.equal((await service.sync({...input,artifactId:pending.artifact_id})).status,'source_changed');
 state.source=candidate.source;state.entries.find(row=>row.locator==='#email').locator='#reviewed-email';
 assert.equal((await service.sync({...input,artifactId:pending.artifact_id})).status,'repository_changed');
});

test('two private query/hash routes retain different scoped object identities without storing raw route values',async()=>{
 const {state,service,input}=fixture();
 state.entries.push({id:'curated-screen',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'Curated generic',locator:'__screen__',metadata:{screen_name:'Curated generic'}},
  {id:'curated-field',project_id:'project',app_type_id:'app',page_url:'https://app.test/login',page_key:'Curated generic',locator:'#email',locator_intent:'Email',metadata:{screen_name:'Curated generic',object_name:'Email'}});
 const bindings=[];
 for(const pageUrl of ['https://app.test/login?view=PRIVATE_ROUTE_A','https://app.test/login#/PRIVATE_ROUTE_B']){
  const candidate=recorded({pageUrl}),pending=await service.stage({...input,...candidate,sourceContext:{caseStartUrl:null,steps:[step]}});state.source=candidate.source;
  const saved=await service.sync({...input,artifactId:pending.artifact_id});bindings.push(saved.bindings[0]);
 }
 assert.notEqual(bindings[0].entry_id,bindings[1].entry_id);assert.notEqual(bindings[0].entry_id,'curated-field');
 assert.equal(state.entries.length,6);assert.equal(state.entries.find(row=>row.id==='curated-field').locator,'#email');
 assert.doesNotMatch(JSON.stringify({entries:state.entries,artifacts:state.artifacts}),/PRIVATE_ROUTE_A|PRIVATE_ROUTE_B|\?view=|#\/PRIVATE/);
 assert.equal(new Set(state.entries.filter(row=>row.metadata.observed_route_sha256).map(row=>row.metadata.observed_route_sha256)).size,2);
 assert.equal(state.entries.filter(row=>row.locator==='#email'&&row.metadata.instruction_usages?.some(usage=>usage.test_case_id==='case'&&usage.step_id==='step')).length,1,'the newer current section retires stale route usage links without deleting objects');
});

test('route-specific legacy intents remain pending and prior source/start URL changes block writes',async()=>{
 const {state,service,input}=fixture(),candidate=recorded({pageUrl:'https://app.test/login?view=private-view'});
 state.source=candidate.source;
 const legacy=await service.stage({...input,...candidate});
 assert.equal((await service.sync({...input,artifactId:legacy.artifact_id})).error_code,'AUTOMATION_OBJECT_ROUTE_CONTEXT_REQUIRED');
 const prior={id:'navigation',step_order:1,step_type:'web',automation_code:'await page.goto("https://app.test/login?view=private-view");'};
 const current={...step,step_order:2};state.contextSteps=[prior,{...current,automation_code:state.source}];state.startUrl='https://app.test/start';
 const pending=await service.stage({...input,...candidate,step:current,sourceContext:{caseStartUrl:state.startUrl,steps:state.contextSteps}});
 state.startUrl='https://app.test/other-start';
 assert.equal((await service.sync({...input,artifactId:pending.artifact_id})).status,'context_changed');assert.equal(state.entries.length,0);
 state.startUrl='https://app.test/start';state.contextSteps[0].automation_code+='\n// edited prerequisite';
 assert.equal((await service.sync({...input,artifactId:pending.artifact_id})).status,'context_changed');assert.equal(state.entries.length,0);
});
