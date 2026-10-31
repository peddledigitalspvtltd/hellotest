const assert=require('node:assert/strict');

// Real PostgreSQL, SDK transport, authorization, native domain services and
// read-back verification. Only the final optional provider response is mocked.
exports.verify=async({app,db,createToken})=>{
  const project='mcp-p-a',application='mcp-app-a',user='mcp-a';
  const headers={authorization:'Bearer '+createToken({id:user})};
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
  const wanted=['testcase.update','testcase.ai','suite.view','suite.create','suite.update','feedback.manage','integration.view'];
  const added=[],records={test_cases:[],test_suites:[],requirements:[],feedback:[]},plans=[];
  let credential,modelId,primaryError;
  const existingCases=new Set((await db.prepare('SELECT id FROM test_cases WHERE app_type_id=? AND created_by=?').all(application,user)).map(row=>row.id));
  const preferenceKey='workspace_preferences:'+user,priorPreferences=(await db.prepare('SELECT value FROM app_settings WHERE key=?').get(preferenceKey))?.value;
  for(const code of wanted){
    const permission=await db.prepare('SELECT id FROM permissions WHERE code=?').get(code);
    assert.ok(permission,code);
    if(!await db.prepare('SELECT 1 AS present FROM role_permissions WHERE role_id=? AND permission_id=?').get('mcp-fixture-role',permission.id)){
      await db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)').run('mcp-fixture-role',permission.id);added.push(permission.id);
    }
  }
  async function rpc(name,args={}){
    const response=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost',authorization:'Bearer '+credential.token,accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:meta}}});
    assert.equal(response.statusCode,200,response.body);
    const result=response.json().result;assert.ok(result,response.body);
    return result;
  }
  async function call(name,args={}){
    const result=await rpc(name,args);assert.equal(result.isError,undefined,JSON.stringify(result));
    assert.equal(result.structuredContent.scope.project_id,project);assert.equal(result.structuredContent.scope.subject,user);
    return result.structuredContent.data;
  }
  async function prepare(name,args){const value=await call(name,args);assert.equal(value.state,'requires_authorization');plans.push(value.plan_id);return value;}
  async function authorize(plan){
    const response=await app.inject({method:'POST',url:`/agentic-workflows/mcp/plans/${encodeURIComponent(plan.plan_id)}/authorize`,headers,payload:{project_id:project,digest:plan.digest}});
    assert.equal(response.statusCode,200,response.body);assert.equal(response.json().state,'authorized');
  }
  async function execute(plan){await authorize(plan);return call('hellotest_operation_execute',{plan_id:plan.plan_id});}
  try{
    const issued=await app.inject({method:'POST',url:'/agentic-workflows/mcp/credentials',headers,payload:{project_id:project,client_id:'feature-integration'}});
    assert.equal(issued.statusCode,200,issued.body);credential=issued.json();

    // More than one full page, including a title that would be a wildcard if
    // it were interpolated rather than treated as a literal SQL predicate.
    for(let index=0;index<53;index++){
      const id=`mcp-feature-page-${String(index).padStart(3,'0')}`;records.test_cases.push(id);
      await db.prepare('INSERT INTO test_cases(id,app_type_id,title) VALUES(?,?,?)').run(id,application,`Feature page ${String(index).padStart(3,'0')}`);
    }
    const pages=[];let offset=0;
    do{
      const page=await call('hellotest_test_cases_list',{search:'Feature page ',limit:20,offset});
      assert.ok(page.items.length<=20);assert.equal(page.projection,'authorized_summary');pages.push(...page.items);
      offset=page.next_offset;
    }while(offset!==null);
    assert.equal(pages.length,53);assert.equal(new Set(pages.map(item=>item.id)).size,53);
    assert.ok(pages.every(item=>item.app_type_id===application));
    assert.deepEqual((await call('hellotest_test_cases_list',{search:'Feature page %',limit:20})).items,[],'Search treats % as a literal.');
    const foreign=await rpc('hellotest_test_cases_get',{test_case_id:'mcp-case-b'});assert.equal(foreign.isError,true);assert.doesNotMatch(JSON.stringify(foreign),/B private case/);
    const environment=await call('hellotest_environments_get',{environment_id:'mcp-env-a'});assert.equal(environment.record.id,'mcp-env-a');assert.equal(environment.record.variables,undefined);assert.doesNotMatch(JSON.stringify(environment),/private-variable/);

    const storyPlan=await prepare('hellotest_story_create_prepare',{title:'Feature fixture registration',description:'An authorized visitor submits the registration form and sees confirmation.',acceptance_criteria:['A successful registration displays confirmation.'],priority:3});
    const story=await execute(storyPlan);assert.equal(story.state,'succeeded_verified');records.requirements.push(story.domain_id);
    assert.equal((await call('hellotest_stories_get',{story_id:story.domain_id})).record.title,'Feature fixture registration');
    const premature=await prepare('hellotest_test_case_create_prepare',{app_type_id:application,title:'Feature fixture Gherkin',description:'Register a visitor and observe confirmation.',authoring_mode:'gherkin',gherkin_document:'Feature: Registration\n  Scenario: Register a visitor\n    Given a visitor is on registration\n    When the visitor submits valid details\n    Then confirmation is displayed',requirement_ids:[story.domain_id]});
    assert.equal((await call('hellotest_operation_execute',{plan_id:premature.plan_id})).state,'requires_authorization','The model cannot approve its own prepared write.');
    const created=await execute(premature);assert.equal(created.state,'succeeded_verified',JSON.stringify(created));records.test_cases.push(created.domain_id);
    const repeated=await call('hellotest_operation_execute',{plan_id:premature.plan_id});assert.equal(repeated.state,'succeeded_verified');
    assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM test_cases WHERE id=?').get(created.domain_id)).count,1);
    const update=await prepare('hellotest_test_case_update_prepare',{test_case_id:created.domain_id,title:'Feature fixture renamed'});
    const edited=await execute(update);assert.equal(edited.state,'succeeded_verified');
    const current=await call('hellotest_test_cases_get',{test_case_id:created.domain_id});assert.equal(current.record.title,'Feature fixture renamed');assert.equal(current.record.authoring_mode,'gherkin','An omitted editor field cannot reset Gherkin to structured mode.');
    const stale=await prepare('hellotest_test_case_update_prepare',{test_case_id:created.domain_id,title:'A stale plan must not replace this title'});
    const concurrent=await app.inject({method:'PUT',url:`/test-cases/${created.domain_id}`,headers,payload:{title:'Feature fixture concurrent edit',author_id:user,...(Number.isInteger(current.record.revision)?{expected_revision:current.record.revision}:{})}});
    assert.equal(concurrent.statusCode,200,concurrent.body);
    const rejected=await app.inject({method:'POST',url:`/agentic-workflows/mcp/plans/${stale.plan_id}/authorize`,headers,payload:{project_id:project,digest:stale.digest}});
    assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().code,'MCP_STALE_PLAN');
    assert.equal((await db.prepare('SELECT title FROM test_cases WHERE id=?').get(created.domain_id)).title,'Feature fixture concurrent edit');
    const cross=await rpc('hellotest_test_case_create_prepare',{app_type_id:'mcp-app-b',title:'Forbidden project B case'});assert.equal(cross.isError,true);

    const suitePlan=await prepare('hellotest_test_suite_create_prepare',{app_type_id:application,name:'Feature fixture suite',test_case_ids:[created.domain_id]});
    const suite=await execute(suitePlan);assert.equal(suite.state,'succeeded_verified',JSON.stringify(suite));records.test_suites.push(suite.domain_id);
    const membership=await db.prepare('SELECT test_case_id FROM suite_test_cases WHERE suite_id=? ORDER BY test_case_id').all(suite.domain_id);assert.deepEqual(membership.map(item=>item.test_case_id),[created.domain_id]);
    const structured=await execute(await prepare('hellotest_test_case_create_prepare',{app_type_id:application,title:'Feature fixture structured steps',steps:[{action:'Open the registration form.',expected_result:'The registration form is visible.'},{action:'Submit valid registration details.',expected_result:'A confirmation is displayed.'}]}));
    assert.equal(structured.state,'succeeded_verified',JSON.stringify(structured));records.test_cases.push(structured.domain_id);
    assert.deepEqual((await db.prepare('SELECT action,expected_result FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(structured.domain_id)).map(row=>({...row})),[{action:'Open the registration form.',expected_result:'The registration form is visible.'},{action:'Submit valid registration details.',expected_result:'A confirmation is displayed.'}]);
    const rewritten=await execute(await prepare('hellotest_test_case_update_prepare',{test_case_id:structured.domain_id,steps:[{action:'Open the registration form and enter the supplied details.',expected_result:'The supplied details are present in the form.'},{action:'Submit the completed form once.',expected_result:'Exactly one confirmation is displayed.'}]}));
    assert.equal(rewritten.state,'succeeded_verified',JSON.stringify(rewritten));
    assert.deepEqual((await db.prepare('SELECT action,expected_result FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(structured.domain_id)).map(row=>({...row})),[{action:'Open the registration form and enter the supplied details.',expected_result:'The supplied details are present in the form.'},{action:'Submit the completed form once.',expected_result:'Exactly one confirmation is displayed.'}]);
    const missingMessage=await rpc('hellotest_defect_create_prepare',{title:'Feature fixture missing message'});assert.equal(missingMessage.isError,true);
    const defectPlan=await prepare('hellotest_defect_create_prepare',{title:'Feature fixture confirmation defect',message:'The registration confirmation remained empty.',linked_test_case_ids:[created.domain_id],linked_requirement_ids:[story.domain_id]});
    const defect=await execute(defectPlan);assert.equal(defect.state,'succeeded_verified',JSON.stringify(defect));records.feedback.push(defect.domain_id);
    assert.equal((await call('hellotest_defects_get',{defect_id:defect.domain_id})).record.message,'The registration confirmation remained empty.');

    const nativeCatalog=await call('hellotest_capabilities',{query:'/test-cases/ai-authoring-preview',family:'test_case_generation',limit:20});
    const generation=nativeCatalog.operations.find(item=>item.path==='/test-cases/ai-authoring-preview'&&item.method==='POST');assert.ok(generation);
    modelId=(await require('../../../../integration/backend/services/integration.service').createIntegration({type:'llm',name:'Disposable MCP feature provider',base_url:'https://mcp-feature-provider.invalid/v1',api_key:'disposable-fixture-value',model:'feature-model',config:{project_id:project},is_active:true})).id;
    const typeField=await require('../../services/dropdownCatalog.service').getField('test_cases.types');
    const caseType=typeField.options.find(option=>option.active!==false).value;
    const originalFetch=global.fetch;let providerCalls=0;
    global.fetch=async(url,init)=>{
      if(!String(url).startsWith('https://mcp-feature-provider.invalid/'))return originalFetch(url,init);
      providerCalls++;const body=JSON.parse(init.body),text=body.messages.map(item=>typeof item.content==='string'?item.content:'').join('\n');
      let value;
      if(text.includes('"evidence_available"'))value={decision:'accept',explanation:'The request authors a concrete registration Test Case.',suggestions:[]};
      else if(text.includes('You plan evidence retrieval'))value={search_queries:['registration confirmation'],source_kinds:['requirement','test_case'],information_needs:['Registration objective'],stop_if_sufficient:true};
      else value={title:'Feature fixture generated proposal',description:'Verify the supplied registration confirmation objective.',priority:3,test_case_type:caseType,authoring_mode:'structured',parameter_values:{},steps:[{step_order:1,step_type:'web',action:'Submit the supplied valid registration details.',expected_result:'Registration confirmation is displayed.'}]};
      return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:20,completion_tokens:20,total_tokens:40}});
    };
    try{
      const countBefore=(await db.prepare('SELECT COUNT(*)::integer AS count FROM test_cases WHERE app_type_id=?').get(application)).count;
      const proposal=await prepare('hellotest_operation_prepare',{operation_id:generation.id,arguments:{body:{app_type_id:application,integration_id:modelId,additional_context:'Generate one positive functional Test Case for a visitor registration confirmation.',test_case:{}}}});
      assert.equal(providerCalls,0,'Preparing an expensive generation does not run the provider.');
      const generated=await execute(proposal);assert.equal(generated.state,'succeeded_proposal',JSON.stringify(generated));assert.equal(generated.verification.persisted,false);assert.equal(generated.verification.approved,false);
      assert.ok(providerCalls>=1);const charged=providerCalls;
      const again=await call('hellotest_operation_execute',{plan_id:proposal.plan_id});assert.equal(again.state,'succeeded_proposal');assert.equal(providerCalls,charged,'Replaying the original receipt cannot duplicate paid generation.');
      assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM test_cases WHERE app_type_id=?').get(application)).count,countBefore,'A generated proposal never auto-saves a Test Case.');
    }finally{global.fetch=originalFetch;}
  }catch(error){primaryError=error;throw error;}finally{
    // This runner owns a disposable database. Cleanup keeps the other native
    // fixtures' exact counts and actor permissions independent of test order.
    const cleanupErrors=[],cleanup=async task=>{try{await task();}catch(error){cleanupErrors.push(error);}};
    // A persisted create can lose its receipt or fail read-back before the
    // assertion records its new ID. Include only this fixture's newly saved
    // actor/application cases so dependent Story cleanup cannot mask that error.
    await cleanup(async()=>{const saved=await db.prepare('SELECT id FROM test_cases WHERE app_type_id=? AND created_by=?').all(application,user);records.test_cases.push(...saved.map(row=>row.id).filter(id=>!existingCases.has(id)));});
    for(const id of new Set(records.test_cases))await cleanup(()=>db.prepare('DELETE FROM test_steps WHERE test_case_id=?').run(id));
    for(const [table,ids]of Object.entries(records))for(const id of new Set(ids))await cleanup(()=>db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id));
    for(const id of plans)await cleanup(()=>db.prepare('DELETE FROM mcp_action_plans WHERE id=?').run(id));
    if(modelId)await cleanup(()=>db.prepare('DELETE FROM integrations WHERE id=?').run(modelId));
    if(credential?.id)await cleanup(()=>db.prepare('DELETE FROM mcp_credentials WHERE id=?').run(credential.id));
    await cleanup(()=>priorPreferences===undefined?db.prepare('DELETE FROM app_settings WHERE key=?').run(preferenceKey):db.prepare('UPDATE app_settings SET value=? WHERE key=?').run(priorPreferences,preferenceKey));
    for(const id of added)await cleanup(()=>db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run('mcp-fixture-role',id));
    if(cleanupErrors.length){if(primaryError)primaryError.cleanupErrors=cleanupErrors;else throw new AggregateError(cleanupErrors,'MCP feature fixture cleanup failed: '+cleanupErrors.map(error=>error.message).join('; '));}
  }
  await require('./mcpLifecycle.fixture').verify({app,db,createToken});
};
