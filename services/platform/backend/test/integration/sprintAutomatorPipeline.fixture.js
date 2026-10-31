const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

// This fixture uses the real native services, HTTP transport, Settings credential
// encryption, API-key authorization and PostgreSQL writes. Only model responses
// are deterministic local-provider fixtures; no application-under-test is called.
module.exports = async function nativePipeline({ app, db, projectId, appId, user, headers }) {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_sprint_automator_\d+$/);
  const runtime = require('../../../../agentic/backend/services/agenticWorkflowExecution.service');
  const nativeTasks = require('../../../../agentic/backend/workflows/artifactTasks');
  const settings = require('../../../../agentic/backend/workflows/connectionSettings');
  const calls = [], failures = [];
  let blockAutomation = false;
  let incompleteReadiness = false;
  let expectAutomaticPublication = false;
  let multiCaseMode = false;
  const providerCredential = 'disposable-native-provider-credential';
  const provider = http.createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw), contents = (request.messages || []).filter(item => typeof item.content === 'string').map(item => item.content);
      const text = contents.join('\n');
      const payloads = contents.flatMap(content => { try { return [JSON.parse(content)]; } catch { return []; } });
      assert.equal(req.headers.authorization, `Bearer ${providerCredential}`);
      assert.equal(req.url, '/v1/chat/completions');
      let result, kind;
      const validation = payloads.find(value => value.evidence_available !== undefined && value.feature === 'ai.test_case.design');
      const design = payloads.find(value => value.application_contract?.max_cases && Array.isArray(value.stories));
      const intent = payloads.find(value => value.question && value.scope);
      const draftRef = text.match(/draft:(story|test-case):[\w:-]+/)?.[0];
      if (validation) {
        kind = 'authoring-validation';
        result = { decision:'accept', explanation:'The supplied objective authors invoice Test Cases.', suggestions:[] };
      } else if (design) {
        kind = 'test-case-generation';
        assert.equal(design.stories.length, 1);
        const source = design.stories[0], color = source.title.includes('blue') ? 'blue' : 'red';
        if (multiCaseMode) assert.equal(design.application_contract.max_cases,3,'The saved generation node limit overrides the legacy trigger limit');
        result = { testCases:Array.from({length:multiCaseMode?3:1},(_,index)=>({ title:`Read ${color} invoice${multiCaseMode?` variant ${index+1}`:''}`, description:`Read the saved ${color} invoice and compare its response.`, priority:2, test_case_type:'functional', authoring_mode:'structured', requirement_refs:[source.ref], parameter_values:{}, steps:[{step_type:'api',action:`GET https://invoices.example/pipeline-${color}`,expected_result:'Response status equals 200 and amount equals 10'}] })) };
      } else if (intent) {
        kind = 'knowledge-intent';
        result = { search_queries:[String(intent.question).slice(0,700)], source_kinds:['requirement'], information_needs:['Recorded invoice acceptance behavior'], stop_if_sufficient:true };
      } else if (/draft-step-1/.test(text) && /native api_request/.test(text)) {
        kind = 'automation';
        const color = text.includes('/pipeline-blue') ? 'blue' : 'red';
        const variant=multiCaseMode?Number(text.match(/Read (?:red|blue) invoice variant (\d)/)?.[1]):null;
        result = multiCaseMode && color==='red' && variant===2 ? {summary:'This middle case has incomplete generated instructions.',steps:[]}
          : blockAutomation && color === 'blue'
          ? {blocked_steps:[{step_id:'draft-step-1',dependency_type:'external_context',reason:'Authentication request contract is missing.',required_context:['Authorized authentication endpoint and method'],required_parameters:[]}]}
          : { summary:`Generated the ${color} invoice native API request.`, steps:[{step_id:'draft-step-1',step_type:'api',api_request:{method:'GET',url:`https://invoices.example/pipeline-${color}`,body_mode:'none',headers:[],validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.amount',operator:'eq',expected:'10'}]}}], learned_locators:[], manual_coverage:[] };
      } else if (draftRef) {
        kind = draftRef.startsWith('draft:story:') ? 'story-assurance' : 'test-case-assurance';
        const ids = kind === 'story-assurance' ? ['industry-standards','usefulness','design-maturity','market-patterns'] : ['scenario-coverage','execution-clarity','data-reliability','trace-maintainability'];
        result = { summary:`Reviewed ${draftRef} against its supplied native evidence.`, verdict:'review_required', dimensions:ids.map(id=>({id,explanation:'The supplied invoice behavior has an observable status and saved amount.',evidence:[draftRef],recommendation:'Review the declared fixture data before executing.'})), insights:[], limitations:['Native review does not establish execution success.'] };
        if (kind === 'test-case-assurance') {
          if (expectAutomaticPublication) {
            const generated = await db.prepare("SELECT COUNT(*)::integer AS count FROM test_cases WHERE app_type_id=? AND source_idempotency_key LIKE ? AND automated='no'")
              .get(appId, `workflow-draft:${runningId}:%`);
            assert.equal(generated.count, multiCaseMode?6:2, 'Generated Library cases must already exist before assurance or automation starts');
          }
          const productRef=text.match(/"ref"\s*:\s*"(requirement:[0-9a-f-]+)"/i)?.[1];
          assert.ok(productRef,'Native readiness must cite the supplied product Story, not only its generated case.');
          if (!incompleteReadiness) result.automation_readiness = {status:'ready',summary:'The selected Story supplies its reviewed GET endpoint, fixture response status and amount.',evidence_refs:[productRef],missing_context:[]};
          else if (text.includes('/pipeline-red')) result.automation_readiness = {status:'needs_input',summary:'The fixture needs a reviewed authentication contract.',evidence_refs:[productRef],missing_context:[{kind:'authentication',reason:'Supply the authorized authentication request contract before generating automation.',evidence_refs:[productRef],step_refs:['step:1']}]};
          // The blue response deliberately omits readiness. The real native
          // assurance service must retain its review while marking it unknown.
        }
      } else throw new Error('The local provider received an unsupported model operation.');
      calls.push({kind,model:request.model,text});
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({id:`fixture-${calls.length}`,model:request.model,choices:[{message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}));
    } catch (error) {
      failures.push(error.message);
      res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}));
    }
  });
  await new Promise(resolve => provider.listen(0,'127.0.0.1',resolve));
  let runningId;
  try {
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT member.role_id,permission.id FROM project_members member CROSS JOIN permissions permission WHERE member.project_id=? AND member.user_id=? AND permission.code IN ('automation.ai','automation.build','knowledge.view','requirement.view','testcase.view') ON CONFLICT DO NOTHING").run(projectId,user.id);
    const integrationId = (await require('../../../../integration/backend/services/integration.service').createIntegration({type:'llm',name:'Disposable native HTTP provider',base_url:`http://127.0.0.1:${provider.address().port}/v1`,api_key:providerCredential,model:'native-http-fixture',config:{project_id:projectId},is_active:true})).id;
    const sprintId=randomUUID(), storyIds=[randomUUID(),randomUUID()];
    await db.prepare("INSERT INTO requirement_iterations(id,project_id,name,state,created_by) VALUES(?,?,?,'active',?)").run(sprintId,projectId,'Native HTTP pipeline Sprint',user.id);
    for (const [index,color] of ['red','blue'].entries()) await db.prepare('INSERT INTO requirements(id,project_id,title,description,additional_fields,iteration_id,revision) VALUES(?,?,?,?,?,?,1)').run(storyIds[index],projectId,`Read ${color} invoice`,`GET https://invoices.example/pipeline-${color} reads a saved invoice.`,{acceptance_criteria:['Response status equals 200 and amount equals 10']},sprintId);
    await app.listen({port:0,host:'127.0.0.1'});
    const apiKey=await require('../../services/apiKey.service').createApiKey({user_id:user.id,name:'Disposable Sprint Story reader',scope:'read'});
    const saved=await app.inject({method:'POST',url:'/agentic-workflows/admin/connections',headers,payload:{project_id:projectId,name:'Disposable native Story HTTP',kind:'http',url:`http://127.0.0.1:${app.server.address().port}`,methods:['GET'],authType:'header',header:'X-API-Key',secret:apiKey.key,allowPrivateNetwork:true,timeoutMs:70000}});
    assert.equal(saved.statusCode,200,saved.body);
    const connection=saved.json();
    const stored=await settings.get(connection.id,projectId);
    assert.ok(stored.encryptedSecret?.ciphertext);
    assert.equal(settings.credential(stored),apiKey.key);
    assert.doesNotMatch(saved.body,new RegExp(apiKey.key));
    const node=(id,kind,data={})=>({id,type:'agenticStep',data:{label:id,kind,...data}});
    const nodes=[node('request','trigger'),node('stories','apiTool',{connectionId:connection.id,apiResource:'sprintStories',apiMethod:'GET',timeoutMs:70000}),node('each','loop',{loopAction:'storyPackets',loopSourceKey:'input.items',loopMaxIterations:100}),...['story-assurance','test-case-generation','test-case-assurance','automation-engineer'].map(task=>node(task,'artifactTask',{artifactTask:task,timeoutMs:1800000,aiConfiguration:{context:{mode:'none',token_budget:1200,max_items:4,required:false,focus:''}}})),node('finish','output')];
    const workflows=require('../../../../agentic/backend/services/agenticWorkflow.service');
    const created=await workflows.createWorkflow({project_id:projectId,app_type_id:appId,name:'Disposable native pipeline',trigger_kind:'manual',status:'draft',settings:{maxDurationMs:3600000},nodes,edges:nodes.slice(1).map((item,index)=>({source:nodes[index].id,target:item.id}))},user.id);
    for (const node of created.nodes.filter(node=>node.data.kind==='artifactTask')) {
      assert.ok(node.data.task?.trim());assert.ok(node.data.instructions?.trim());assert.ok(node.data.guardrails?.trim());
    }
    const customInstructions='Use only the selected invoice Story and make its saved amount assertion explicit.';
    const workflow=await workflows.updateWorkflow(created.id,{nodes:created.nodes.map(node=>node.id==='story-assurance'?{...node,data:{...node.data,instructions:customInstructions,guardrails:''}}:node)},user.id);
    const persisted=(await db.prepare('SELECT nodes FROM agentic_workflows WHERE id=?').get(workflow.id)).nodes.find(node=>node.id==='story-assurance').data;
    assert.equal(persisted.instructions,customInstructions);assert.equal(persisted.guardrails,'');
    const input={request_id:randomUUID(),input_payload:{sprint_id:sprintId,integration_id:integrationId,max_cases_per_story:1,generation_instructions:'Draft native invoice Test Cases using the selected Story only.'}};
    const readiness=await runtime.checkReadiness(workflow,'',user,input.input_payload);
    assert.equal(readiness.ready,true,JSON.stringify(readiness.blockers));
    const before=(await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count;
    const started=await runtime.start(workflow,input,user);runningId=started.id;
    await runtime._internals.active.get(started.id)?.promise;
    const completed=await runtime._internals.store.get(started.id);
    assert.equal(completed.status,'completed',JSON.stringify({project_id:projectId,app_type_id:appId,output:completed.output_payload,failures:completed.node_results.filter(row=>row.status==='failed').map(row=>({id:row.node_id,error:row.error,logs:row.logs?.slice(-2)})),provider_failures:failures}));
    const finalNode=completed.node_results.find(row=>row.node_id==='automation-engineer');
    assert.equal(finalNode.output.data[0].story_assurance,undefined,'Public automation output contains only its own stage');
    const final=finalNode.execution_context;
    assert.deepEqual(final.data.map(packet=>packet.story_id).sort(),storyIds.sort());
    for(const packet of final.data) {
      assert.equal(packet.story_assurance.integration.id,integrationId);
      assert.equal(packet.case_assurance[0].integration.id,integrationId);
      assert.equal(packet.automation[0].integration.id,integrationId);
      assert.equal(packet.automation[0].validation.status,'passed');
      assert.equal(packet.automation[0].verification_status,'unverified');
      assert.equal(packet.automation[0].steps[0].api_request.validations.length,2);
      assert.deepEqual(packet.automation[0].side_effects,{cases_saved:0,target_requests:0,browser_actions:0});
      assert.equal(packet.case_assurance[0].case_fingerprint,nativeTasks.fingerprint(packet.cases[0]));
      assert.equal(packet.case_assurance[0].assurance_review.automation_readiness.status,'ready');
    }
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count,before,'Native pipeline stages return drafts without saving library records');
    const callCount=calls.length;
    const replay=await runtime.start(workflow,input,user);
    assert.equal(replay.id,started.id);assert.equal(calls.length,callCount,'Replaying the request ID must not dispatch another model call');
    for(const kind of ['story-assurance','test-case-generation','test-case-assurance','automation']) assert.equal(calls.filter(call=>call.kind===kind).length,2,kind);
    for(const call of calls.filter(call=>['test-case-generation','test-case-assurance','automation'].includes(call.kind))) assert.equal(storyIds.filter(id=>call.text.includes(id)).length,1,'Every downstream model call is limited to its one selected Story');
    assert.ok(calls.every(call=>call.model==='native-http-fixture'));
    assert.ok(calls.every(call=>!call.text.includes(apiKey.key)),'Settings API credentials must never reach the model');
    assert.deepEqual(failures,[]);
    assert.ok(calls.filter(call=>call.kind==='story-assurance').every(call=>call.text.includes(customInstructions)),'The persisted node instructions must reach its real provider request.');
    const manual=await app.inject({method:'POST',url:`/agentic-workflow-runs/${started.id}/drafts/accept`,headers,payload:{node_id:'automation-engineer',story_index:0,case_index:0,kind:'manual'}});
    assert.equal(manual.statusCode,200,manual.body);
    const automated=await app.inject({method:'POST',url:`/agentic-workflow-runs/${started.id}/drafts/accept`,headers,payload:{node_id:'automation-engineer',story_index:0,case_index:0,kind:'automation'}});
    assert.equal(automated.statusCode,200,automated.body);
    assert.equal(automated.json().verification_status,'unverified');
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM automation_case_links WHERE automation_test_case_id=? AND manual_test_case_id=?').get(automated.json().id,manual.json().id)).count,1);
    blockAutomation = true;
    const beforeBlocked=(await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count;
    const blockedStart=await runtime.start(workflow,{...input,request_id:randomUUID()},user);runningId=blockedStart.id;
    await runtime._internals.active.get(blockedStart.id)?.promise;
    const blockedRun=await runtime._internals.store.get(blockedStart.id);
    assert.equal(blockedRun.status,'needs_review',JSON.stringify(blockedRun.output_payload));
    const blockedNode=blockedRun.node_results.find(row=>row.node_id==='automation-engineer');
    assert.equal(blockedNode.status,'completed');assert.equal(blockedNode.output.verification.status,'needs_input');
    const blockedIndex=blockedNode.output.data.findIndex(packet=>packet.automation_input_required?.length);
    assert.ok(blockedIndex>=0);
    const blockedPacket=blockedNode.execution_context.data[blockedIndex];
    assert.equal(blockedPacket.automation[0],null);
    assert.equal(blockedPacket.automation_input_required[0].code,'AUTOMATION_DEPENDENCY_MISSING');
    assert.match(blockedPacket.automation_input_required[0].blocked_steps[0].required_context[0],/authentication endpoint/);
    assert.equal(blockedPacket.case_assurance[0].verification.status,'passed');
    assert.equal(blockedPacket.case_assurance[0].case_fingerprint,nativeTasks.fingerprint(blockedPacket.cases[0]));
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count,beforeBlocked);
    const blockedManual=await app.inject({method:'POST',url:`/agentic-workflow-runs/${blockedStart.id}/drafts/accept`,headers,payload:{node_id:'automation-engineer',story_index:blockedIndex,case_index:0,kind:'manual'}});
    assert.equal(blockedManual.statusCode,200,blockedManual.body);
    const blockedAutomation=await app.inject({method:'POST',url:`/agentic-workflow-runs/${blockedStart.id}/drafts/accept`,headers,payload:{node_id:'automation-engineer',story_index:blockedIndex,case_index:0,kind:'automation'}});
    assert.equal(blockedAutomation.statusCode,409,blockedAutomation.body);
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count,beforeBlocked+1);
    incompleteReadiness = true;
    const beforeReadiness=(await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count;
    const automationCalls=calls.filter(call=>call.kind==='automation').length;
    const strictReadinessWorkflow={...workflow,nodes:workflow.nodes.map(node=>node.data.artifactTask==='automation-engineer'?{...node,data:{...node.data,readinessPolicy:'require-ready'}}:node)};
    const readinessStart=await runtime.start(strictReadinessWorkflow,{...input,request_id:randomUUID()},user);runningId=readinessStart.id;
    await runtime._internals.active.get(readinessStart.id)?.promise;
    const readinessRun=await runtime._internals.store.get(readinessStart.id);
    assert.equal(readinessRun.status,'needs_review',JSON.stringify(readinessRun.output_payload));
    const readinessNode=readinessRun.node_results.find(row=>row.node_id==='automation-engineer');
    assert.equal(readinessNode.status,'completed');assert.equal(readinessNode.output.verification.status,'needs_input');
    assert.deepEqual(readinessNode.execution_context.data.map(packet=>packet.case_assurance[0].assurance_review.automation_readiness.status).sort(),['needs_input','unknown']);
    assert.ok(readinessNode.execution_context.data.every(packet=>packet.automation[0]===null && packet.automation_input_required.length===1 && packet.case_assurance[0].case_fingerprint===nativeTasks.fingerprint(packet.cases[0])));
    assert.equal(calls.filter(call=>call.kind==='automation').length,automationCalls,'Unknown and needs_input assurance must never dispatch automation model requests.');
    const readinessManual=await app.inject({method:'POST',url:`/agentic-workflow-runs/${readinessStart.id}/drafts/accept`,headers,payload:{node_id:'automation-engineer',story_index:0,case_index:0,kind:'manual'}});
    assert.equal(readinessManual.statusCode,200,readinessManual.body);
    const readinessAutomation=await app.inject({method:'POST',url:`/agentic-workflow-runs/${readinessStart.id}/drafts/accept`,headers,payload:{node_id:'automation-engineer',story_index:0,case_index:0,kind:'automation'}});
    assert.equal(readinessAutomation.statusCode,409,readinessAutomation.body);
    assert.equal((await db.prepare('SELECT count(*)::INTEGER AS count FROM test_cases WHERE app_type_id=?').get(appId)).count,beforeReadiness+1);
    // Sprint Automator's explicit automatic policy publishes generated cases
    // before downstream work. Other workflows above keep manual acceptance.
    expectAutomaticPublication = true;
    const automaticWorkflow = { ...strictReadinessWorkflow, id: randomUUID(), settings: { ...workflow.settings,
      template_id: 'sprint-automator', library_publication_mode: 'automatic', requires_human_review: false } };
    const autoInput = { ...input, request_id: randomUUID() };
    const automationBefore = calls.filter(call=>call.kind==='automation').length;
    const autoBlocked = await runtime.start(automaticWorkflow, autoInput, user); runningId = autoBlocked.id;
    await runtime._internals.active.get(autoBlocked.id)?.promise;
    const autoBlockedRun = await runtime._internals.store.get(autoBlocked.id);
    assert.ok(['completed','needs_review'].includes(autoBlockedRun.status), JSON.stringify(autoBlockedRun.output_payload));
    const generatedPublication = autoBlockedRun.node_results.find(row=>row.node_id==='test-case-generation').output.library_publication;
    assert.equal(generatedPublication.manual_cases_saved, 2);
    assert.equal(generatedPublication.receipts.length, 2);
    for (const receipt of generatedPublication.receipts) {
      const saved = await db.prepare('SELECT status,automated,ai_generation_source,ai_generation_review_status,review_status,reviewer_id,created_by,source_idempotency_key,ai_generated_at FROM test_cases WHERE id=?').get(receipt.id);
      assert.equal(saved.status, 'draft'); assert.equal(saved.automated, 'no');
      assert.equal(saved.ai_generation_source, 'interactive'); assert.equal(saved.ai_generation_review_status, 'pending');
      assert.equal(saved.review_status, 'pending'); assert.equal(saved.reviewer_id, user.id); assert.equal(saved.created_by, user.id);
      assert.ok(saved.ai_generated_at); assert.ok(saved.source_idempotency_key.startsWith(`workflow-draft:${autoBlocked.id}:`));
      assert.equal(receipt.approved, undefined); assert.equal(receipt.requires_review, true);
    }
    assert.equal(calls.filter(call=>call.kind==='automation').length, automationBefore, 'Strict readiness gaps retain manual publication without dispatching automation');
    const autoCount = (await db.prepare('SELECT COUNT(*)::integer AS count FROM test_cases WHERE source_idempotency_key LIKE ?').get(`workflow-draft:${autoBlocked.id}:%`)).count;
    const callsBeforeReplay = calls.length;
    assert.equal((await runtime.start(automaticWorkflow, autoInput, user)).id, autoBlocked.id);
    assert.equal(calls.length, callsBeforeReplay);
    assert.equal(autoCount, 2);
    // A ready native draft can additionally publish its validated, unverified
    // automation while retaining its generated manual case relationship.
    incompleteReadiness = false; blockAutomation = false;
    const autoReady = await runtime.start(automaticWorkflow, { ...input, request_id: randomUUID() }, user); runningId = autoReady.id;
    await runtime._internals.active.get(autoReady.id)?.promise;
    const autoReadyRun = await runtime._internals.store.get(autoReady.id);
    assert.equal(autoReadyRun.status, 'completed', JSON.stringify(autoReadyRun.output_payload));
    const automatic = autoReadyRun.node_results.find(row=>row.node_id==='automation-engineer').output.library_publication;
    assert.equal(automatic.automation_cases_saved, 2);
    for (const receipt of automatic.receipts) {
      assert.equal(receipt.verification_status, 'unverified'); assert.equal(receipt.requires_test_run, true);
      const saved = await db.prepare('SELECT automation_status,review_status,ai_generation_review_status FROM test_cases WHERE id=?').get(receipt.id);
      assert.equal(saved.automation_status, 'incomplete'); assert.equal(saved.review_status, 'pending'); assert.equal(saved.ai_generation_review_status, 'pending');
      assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM automation_case_links WHERE automation_test_case_id=?').get(receipt.id)).count,1);
    }
    // Default successor behavior independently checks the pinned source. A
    // conservative or absent upstream readiness verdict cannot substitute for
    // the real builder's own executable contract validation.
    incompleteReadiness = true;
    const independentWorkflow={...automaticWorkflow,id:randomUUID(),nodes:automaticWorkflow.nodes.map(node=>node.data.artifactTask==='automation-engineer'?{...node,data:{...node.data,readinessPolicy:'verify-inputs'}}:node)};
    const independentStart=await runtime.start(independentWorkflow,{...input,request_id:randomUUID()},user);runningId=independentStart.id;
    await runtime._internals.active.get(independentStart.id)?.promise;
    const independentRun=await runtime._internals.store.get(independentStart.id);
    assert.equal(independentRun.status,'completed',JSON.stringify(independentRun.output_payload));
    const independentNode=independentRun.node_results.find(row=>row.node_id==='automation-engineer');
    assert.deepEqual(independentNode.execution_context.data.map(packet=>packet.case_assurance[0].assurance_review.automation_readiness.status).sort(),['needs_input','unknown']);
    assert.equal(independentNode.output.library_publication.automation_cases_saved,2);
    assert.ok(independentNode.output.data.every(packet=>packet.automation[0].validation.status==='passed'&&packet.automation[0].verification_status==='unverified'));
    // A case-specific generation failure preserves the earlier full case and
    // proceeds to the later case, including real native Library publication.
    // The pinned node limit deliberately differs from the legacy trigger.
    multiCaseMode=true;incompleteReadiness=false;
    const multipleWorkflow={...independentWorkflow,id:randomUUID(),nodes:independentWorkflow.nodes.map(node=>node.data.artifactTask==='test-case-generation'
      ? {...node,data:{...node.data,maxCasesPerStory:3,authoringMode:'structured',generationInstructions:''}}:node)};
    const multipleStart=await runtime.start(multipleWorkflow,{...input,request_id:randomUUID()},user);runningId=multipleStart.id;
    await runtime._internals.active.get(multipleStart.id)?.promise;
    const multipleRun=await runtime._internals.store.get(multipleStart.id);
    assert.equal(multipleRun.status,'needs_review',JSON.stringify(multipleRun.output_payload));
    const multipleNode=multipleRun.node_results.find(row=>row.node_id==='automation-engineer');
    assert.equal(multipleNode.status,'completed');assert.equal(multipleNode.output.outcome,'automation_partial');
    assert.equal(multipleNode.output.failed_case_count,1);
    const red=multipleNode.execution_context.data.find(packet=>packet.story.title.includes('red'));
    assert.deepEqual(red.automation.map(item=>Boolean(item)),[true,false,true]);
    assert.equal(red.automation_failures[0].case_index,1);assert.equal(red.automation_failures[0].code,'AUTOMATION_BUILD_INCOMPLETE');
    assert.deepEqual(red.automation_progress,{completed:2,failed:1,needs_input:0,processed:3,total:3});
    assert.equal(multipleRun.node_results.find(row=>row.node_id==='test-case-generation').output.library_publication.manual_cases_saved,6);
    assert.equal(multipleNode.output.library_publication.automation_cases_saved,5);
    const publicationReplay=await require('../../../../agentic/backend/workflows/acceptDraft').publishNodeArtifacts({run:multipleRun,node:{id:'automation-engineer'},user});
    assert.equal(publicationReplay.receipts.length,5);assert.ok(publicationReplay.receipts.every(receipt=>receipt.reused));
    assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM test_cases WHERE source_idempotency_key LIKE ?').get(`workflow-draft:${multipleRun.id}:%`)).count,11);
    assert.deepEqual(failures, []);
    return {native_services_real:true,settings_credential_http_real:true,stories:final.data.length,model_provider:'local HTTP response fixture',model_calls:calls.length,request_replay_extra_calls:0,other_workflows_keep_manual_publication:true,native_acceptances:4,automatic_pending_review_manual_cases:12,automatic_unverified_automation_cases:9,known_native_dependency_retains_assessed_manual_draft:true,strict_unknown_and_missing_readiness_extra_automation_calls:0,independent_native_generation_resolves_upstream_readiness:true,readiness_manual_acceptance_preserved:true,blocked_automation_acceptance_rejected:true,all_cases_attempted_after_middle_failure:true,partial_success_library_receipts_idempotent:true,node_generation_limit_overrides_legacy_trigger:true};
  } finally {
    const active=runningId&&runtime._internals.active.get(runningId);
    active?.controller.abort();await active?.promise;
    await new Promise(resolve=>provider.close(resolve));
  }
};
