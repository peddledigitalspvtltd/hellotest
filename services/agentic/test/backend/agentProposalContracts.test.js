const test=require('node:test'),assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db');
const applications=require('@hellotest/platform/backend/public/applicationAccess');
const {normalizeArtifacts}=require('../../backend/services/agentArtifacts');
const {proposalOperation,accept}=require('../../backend/services/agentProposal.service');
const citation={id:'recorded'},base={title:'Approved retry',description:'One approved request is retained.',priority:'P2',citation_ids:['recorded']};
const caseDraft={...base,kind:'test_case',test_case_type:'customer_contract',parameter_values:{'t.user':'reviewed@example.test'},steps:[{action:'Retry with @t.user',expected_result:'One request remains.'}]};
function reviewFor(artifact,extra={}){return{session_state:'completed',transaction:{id:'review',project_id:'project',app_type_id:'app',status:'completed'},citations:[citation],result:{artifacts:[artifact],findings:[],verification:{status:'passed'},readiness:{status:'ready_for_review'},...extra}};}
function fixture(t,{deny}={}){
 const calls={permissions:[],destinations:[],writes:[]},receipts=new Map();
 t.mock.method(applications,'getAppType',async()=>({id:'app',project_id:'project',type:'web'}));
 t.mock.method(db,'transaction',fn=>async()=>fn());
 t.mock.method(db,'prepare',sql=>({get:async(...args)=>sql.includes('agent_proposal_acceptances')?receipts.get(args[0]+':'+args[1]):{},run:async(...args)=>{
  assert.match(sql,/INSERT INTO agent_proposal_acceptances/);calls.writes.push(args);receipts.set(args[0]+':'+args[1],{request_hash:args[4],receipt:args[5]});
 }}));
 const app={requirePermission:permission=>async()=>{calls.permissions.push(permission);if(deny===permission)throw Object.assign(new Error('Denied'),{statusCode:403});},inject:async input=>{calls.destinations.push(input);return{statusCode:200,json:()=>({id:'saved'})};}};
 return{app,calls};
}

test('reviewed case acceptance retains admin-defined type and literal parameter values',async t=>{
 const {app,calls}=fixture(t),[artifact]=normalizeArtifacts([caseDraft],[citation],[],{requireMetadata:true,testCaseTypes:['customer_contract']});
 const receipt=await accept(app,{user:{id:'reviewer'},body:{index:0,artifact}},reviewFor(artifact));
 assert.equal(receipt.kind,'test_case');assert.equal(calls.destinations[0].payload.test_case_type,'customer_contract');
 assert.deepEqual(calls.destinations[0].payload.parameter_values,{'t.user':'reviewed@example.test'});
 assert.equal(calls.destinations[0].payload.steps[0].action,'Retry with @t.user');
 assert.equal((await accept(app,{user:{id:'reviewer'},body:{index:0,artifact}},reviewFor(artifact))).reused,true);
 assert.equal(calls.destinations.length,1,'native create is not replayed after acceptance');
});

test('automation approval creates only an incomplete Plan and rechecks every automation permission',async t=>{
 const draft={...caseDraft,kind:'automation',start_url:'http://localhost:8080/auth',manual_test_case_ids:['manual']};
 const [artifact]=normalizeArtifacts([draft],[citation],[{id:'manual',kind:'test_case',citation_id:'recorded'}],{requireMetadata:true});
 const {app,calls}=fixture(t),receipt=await accept(app,{user:{id:'reviewer'},body:{index:0,artifact}},reviewFor(artifact));
 assert.deepEqual(calls.permissions,['testcase.create','automation.view','automation.code.view','automation.build']);
 const payload=calls.destinations[0].payload;assert.equal(calls.destinations[0].url,'/test-cases');assert.equal(payload.automated,'yes');assert.equal(payload.automation_status,'incomplete');assert.equal(payload.automation_start_url,'http://localhost:8080/auth');assert.deepEqual(payload.manual_test_case_ids,['manual']);
 assert.ok(payload.steps.every(step=>!Object.hasOwn(step,'automation_code')&&!Object.hasOwn(step,'api_request')));
 assert.equal(receipt.plan_only,true);assert.equal(receipt.build_required,true);
});

test('denied automation access rejects an otherwise valid Plan before native writes',async t=>{
 const [artifact]=normalizeArtifacts([{...caseDraft,kind:'automation',start_url:'https://fixture.test/auth'}],[citation],[],{requireMetadata:true});
 const {app,calls}=fixture(t,{deny:'automation.build'});
 await assert.rejects(accept(app,{user:{id:'reviewer'},body:{index:0,artifact}},reviewFor(artifact)),{statusCode:403});
 assert.deepEqual(calls.destinations,[]);assert.deepEqual(calls.writes,[]);
});

test('unresolved evidence, failed verification and unfinished declared outputs cannot be approved',async t=>{
 const {app,calls}=fixture(t);
 for(const extra of [{verification:{status:'needs_input'}},{verification:{status:'failed'}},{readiness:{status:'insufficient_evidence'}},{outcome_issues:[{code:'AGENT_OUTCOME_PROPOSAL_REQUIRED'}]}]){
  await assert.rejects(accept(app,{user:{id:'reviewer'},body:{index:0,artifact:caseDraft}},reviewFor(caseDraft,extra)),{statusCode:409});
 }
 assert.deepEqual(calls.destinations,[]);assert.deepEqual(calls.writes,[]);
});

test('native defect priorities use the application risk scale and approved Run criteria have a durable receipt',async t=>{
 const defect={...base,kind:'defect',severity:'high',reproduction_steps:['Retry the recorded request.'],expected_result:'One request',actual_result:'Two requests'};
 const operation=proposalOperation(defect,defect,reviewFor(defect),'app','reviewer');assert.equal(operation.payload.priority,'High');
 const [run]=normalizeArtifacts([{...base,kind:'run',test_case_ids:['case'],exit_criteria:['Every selected case passes with current evidence.']}],[citation],[{kind:'test_case',id:'case',citation_id:'recorded'}]);
 const {app,calls}=fixture(t),receipt=await accept(app,{user:{id:'reviewer'},body:{index:0,artifact:run}},reviewFor(run));
 assert.equal(calls.destinations[0].url,'/executions');assert.equal(calls.destinations[0].payload.execution_mode,'manual');
 assert.deepEqual(receipt.review_context,{description:run.description,exit_criteria:run.exit_criteria});
});

test('native acceptance cannot invent or remap the finding covered by a recorded proposal',()=>{
 const artifact={...caseDraft,addressed_finding_ids:['finding-1']},review=reviewFor(artifact,{findings:[{id:'finding-1',citation_ids:['recorded']}]});
 assert.equal(proposalOperation(artifact,artifact,review,'app','reviewer').artifact.addressed_finding_ids[0],'finding-1');
 assert.throws(()=>proposalOperation(artifact,{...artifact,addressed_finding_ids:['other']},review,'app','reviewer'),/recorded finding links|finding references/);
 assert.throws(()=>proposalOperation(artifact,{...artifact,addressed_finding_ids:[]},review,'app','reviewer'),/recorded finding links/);
 for(const key of ['priority','test_case_type','parameter_values'])assert.throws(()=>proposalOperation(caseDraft,{...caseDraft,[key]:undefined},reviewFor(caseDraft),'app','reviewer'),/reviewed priority|invalid fields/);
});
