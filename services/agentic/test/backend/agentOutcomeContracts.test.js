const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeArtifacts,outcomeContract,outcomeIssues,planFollowups}=require('../../backend/services/agentArtifacts');
const definition=require('../../backend/agents/agentDefinition');
const profiles=require('../../shared/workflowSpecialists.json');
const catalog=require('../../shared/agentOutcomeContracts.json');
const citations=[{id:'case-source'}],base={title:'Retry once',description:'Verify the approved retry boundary.',priority:'P2',citation_ids:['case-source']};
const caseDraft={...base,kind:'test_case',test_case_type:'functional',parameter_values:{'t.email':'reviewed@example.test'},steps:[{action:'Enter @t.email and retry the request.',expected_result:'One request remains.'}]};
const finding={id:'finding-1',title:'Missing test coverage',detail:'Add a Test Case for the approved retry boundary.',citation_ids:['case-source']};
const review=(extra={})=>({response:'Observed the recorded behavior.',citation_ids:['case-source'],findings:[],artifacts:[],evidence_gaps:[],...extra});

test('every builtin has a bounded output contract, and clean readonly reviews need no invented artifacts',()=>{
 assert.deepEqual(Object.keys(catalog.agents).sort(),Object.keys(profiles).sort());
 for(const id of Object.keys(profiles)){const contract=outcomeContract(id);assert.equal(contract.schema,'agent-outcome/1');assert.ok(['author','review'].includes(contract.mode));}
 for(const id of ['risk-prediction','bug-triage','flaky-test-intelligence','quality-evaluator'])assert.deepEqual(outcomeIssues(review(),outcomeContract(id)),[],id);
});

test('authoring completion requires concrete native drafts and reports only specific evidence gaps as blocked',()=>{
 const contract=outcomeContract('test-designer');
 assert.ok(outcomeIssues(review({deliverables:[{title:'Suggested case',detail:'Review test coverage.'}]}),contract).some(issue=>issue.code==='AGENT_OUTCOME_PROPOSAL_REQUIRED'&&!issue.blocked));
 const blocked=outcomeIssues(review({evidence_gaps:['The approved expected response for a repeated request is not supplied.']}),contract);
 assert.equal(blocked[0].blocked,true);
 assert.equal(outcomeIssues(review({evidence_gaps:['Insufficient evidence']}),contract)[0].blocked,undefined);
 const [artifact]=normalizeArtifacts([caseDraft],citations,[],{requireMetadata:true});
 assert.deepEqual(outcomeIssues(review({artifacts:[artifact]}),contract),[]);
 assert.ok(outcomeIssues(review({artifacts:[{...artifact,kind:'story'}]}),contract).some(issue=>issue.code==='AGENT_OUTCOME_KIND_MISMATCH'));
});

test('a cited builtin improvement may explicitly establish no change, while custom authoring cannot self-waive output',()=>{
 const clean=review({no_changes_required:true});
 assert.deepEqual(outcomeIssues(clean,outcomeContract('test-improvement')),[]);
 assert.ok(outcomeIssues({...clean,citation_ids:[]},outcomeContract('test-improvement')).length);
 assert.ok(outcomeIssues({...clean,findings:[finding]},outcomeContract('test-improvement')).length);
 const custom=definition.normalize({name:'Case author',objective:'Draft one case from the supplied requirement.',output_contract:{kind:'test_case',minimum_artifacts:1}});
 assert.ok(outcomeIssues(clean,outcomeContract('agent-custom',custom)).length);
});

test('validated successor outputs supplement an author without replacing its required primary proposal',()=>{
 const contract={...outcomeContract('story-architect'),supplemental_artifact_kinds:['test_case']};
 const story={kind:'story',title:'Checkout',citation_ids:['case-source']};
 assert.deepEqual(outcomeIssues(review({artifacts:[story,caseDraft]}),contract),[]);
 assert.ok(outcomeIssues(review({artifacts:[caseDraft]}),contract).some(issue=>issue.code==='AGENT_OUTCOME_PROPOSAL_REQUIRED'));
 assert.ok(outcomeIssues(review({artifacts:[story,{...caseDraft,kind:'defect'}]}),contract).some(issue=>issue.code==='AGENT_OUTCOME_KIND_MISMATCH'));
});

test('custom output contracts are immutable typed settings with bounded authoring counts',()=>{
 const base={name:'Custom author',objective:'Prepare the configured native outcome.'};
 assert.deepEqual(definition.normalize(base).output_contract,{kind:'review',minimum_artifacts:0},'saved legacy definitions retain review semantics');
 assert.deepEqual(definition.normalize({...base,output_contract:{kind:'story',minimum_artifacts:2}}).output_contract,{kind:'story',minimum_artifacts:2});
 for(const output_contract of [{kind:'shell',minimum_artifacts:1},{kind:'story',minimum_artifacts:0},{kind:'story',minimum_artifacts:9},{kind:'review',minimum_artifacts:1},{kind:'story',minimum_artifacts:1,verifier:'return true'}])assert.throws(()=>definition.normalize({...base,output_contract}),error=>error.code==='AGENT_DEFINITION_INVALID');
});

test('review proposals must address exact actionable finding identities with overlapping permitted evidence',()=>{
 const contract=outcomeContract('quality-evaluator');
 assert.ok(outcomeIssues(review({findings:[finding]}),contract).some(issue=>issue.code==='AGENT_OUTCOME_FINDING_UNRESOLVED'));
 const artifact={...caseDraft,addressed_finding_ids:['finding-1']};
 assert.deepEqual(outcomeIssues(review({findings:[finding],artifacts:[artifact]}),contract),[]);
 for(const changed of [{...artifact,addressed_finding_ids:[]},{...artifact,addressed_finding_ids:['invented']},{...artifact,citation_ids:['other-source']}])assert.ok(outcomeIssues(review({findings:[finding],artifacts:[changed]}),contract).length);
 const plan=planFollowups('quality-evaluator',['test-cases'],review({findings:[finding]}));assert.deepEqual(plan[0].finding_ids,['finding-1']);
 assert.deepEqual(planFollowups('test-designer',['test-cases'],review({findings:[finding]})),[],'same specialist cannot recursively hand off to itself');
 assert.ok(outcomeIssues(review({findings:[finding,{...finding,title:'Different gap'}],artifacts:[artifact]}),contract).some(issue=>issue.code==='AGENT_OUTCOME_FINDING_CONTRACT_INVALID'));
});

test('typed cited findings route without English keywords while explicit no-proposal and unobserved defect tags remain analysis',()=>{
 const typed={...finding,title:'कवरेज',detail:'स्वीकृत व्यवहार के लिए परीक्षण।',artifact_kind:'test_case',requires_proposal:true};
 const plan=planFollowups('quality-evaluator',['test-cases'],review({findings:[typed]}));
 assert.equal(plan[0].agent_id,'test-designer');assert.deepEqual(plan[0].finding_ids,['finding-1']);
 assert.equal(plan[0].reason,profiles['test-designer'].description);
 assert.deepEqual(planFollowups('quality-evaluator',['test-cases'],review({findings:[{...typed,requires_proposal:false}]})),[]);
 assert.deepEqual(planFollowups('quality-evaluator',['stories'],review({findings:[typed]})),[]);
 assert.deepEqual(planFollowups('failure-analyst',['bugs'],review({findings:[{...typed,artifact_kind:'defect',detail:'Possible product defect without observed failure evidence.'}]})),[]);
});

test('strict generated artifact metadata survives normalization without accepting invalid types, params or missing fields',()=>{
 const [artifact]=normalizeArtifacts([caseDraft],citations,[],{requireMetadata:true,testCaseTypes:['functional','customer_contract']});
 assert.equal(artifact.test_case_type,'functional');assert.deepEqual(artifact.parameter_values,caseDraft.parameter_values);
 assert.equal(normalizeArtifacts([{...caseDraft,test_case_type:'customer_contract'}],citations,[],{requireMetadata:true,testCaseTypes:['customer_contract']})[0].test_case_type,'customer_contract');
 for(const [key,value]of [['priority',undefined],['priority','invalid'],['test_case_type',undefined],['test_case_type','retired'],['parameter_values',undefined],['parameter_values',{'r.email':'wrong namespace'}],['parameter_values',{'s.email':'wrong namespace'}],['prerequisites','invalid'],['target_id','not-a-supported-case-update']])assert.throws(()=>normalizeArtifacts([{...caseDraft,[key]:value}],citations,[],{requireMetadata:true,testCaseTypes:['functional']}),error=>error.code==='AI_INVALID_RESPONSE',key);
 assert.equal(normalizeArtifacts([{...caseDraft,priority:2}],citations,[],{requireMetadata:true})[0].priority,'P2','native integer priority is an unambiguous supported alias');
 assert.equal(normalizeArtifacts([{...base,kind:'test_case',steps:caseDraft.steps}],citations)[0].test_case_type,undefined,'old saved drafts remain readable');
 assert.throws(()=>normalizeArtifacts([{...base,kind:'defect',severity:'unknown',reproduction_steps:['Retry'],expected_result:'One request',actual_result:'Two requests'}],citations));
});

test('automation artifacts contain a cited Plan and start URL, never executable scripts or invented manual targets',()=>{
 const draft={...caseDraft,kind:'automation',manual_test_case_ids:['manual-case'],start_url:'http://localhost:8080/auth'};
 const targets=[{kind:'test_case',id:'manual-case',citation_id:'case-source'}];
 const [artifact]=normalizeArtifacts([draft],citations,targets,{requireMetadata:true});
 assert.deepEqual(artifact.manual_test_case_ids,['manual-case']);assert.equal(artifact.start_url,'http://localhost:8080/auth');
 for(const changed of [{...draft,start_url:''},{...draft,start_url:'https://user:password@example.test'},{...draft,manual_test_case_ids:['invented']},{...draft,steps:[{...draft.steps[0],automation_code:'await arbitrary();'}]}])assert.throws(()=>normalizeArtifacts([changed],citations,targets,{requireMetadata:true}));
});

test('full selected-case Story links permit traceability without granting unversioned Story updates',()=>{
 const artifacts=require('../../backend/services/agentArtifacts');
 const citation={id:'K-selected-case'};
 const context={case_intent:[{source_kind:'live_project',citation,content:JSON.stringify({evidence_type:'authoritative_full_test_case_intent',evidence_permissions:['testcase.view','requirement.view'],completeness:{story_traceability_included:true},records:[{id:'case-1',requirement_ids:['story-1']}]})}]};
 const targets=artifacts.storyTargets(context);
 assert.ok(targets.some(target=>target.id==='story-1'&&target.kind==='story_link'));
 const base={title:'Supported proposal',description:'Cited source',priority:'P2',citation_ids:[citation.id]};
 const [result]=artifacts.normalizeArtifacts([{...base,kind:'test_case',test_case_type:'functional',parameter_values:{},requirement_ids:['story-1'],steps:[{action:'Open',expected_result:'Visible'}]}],[citation],targets,{requireMetadata:true});
 assert.deepEqual(result.requirement_ids,['story-1']);
 assert.throws(()=>artifacts.normalizeArtifacts([{...base,kind:'story',target_id:'story-1',acceptance_criteria:['Given a request, when submitted, then its result is visible.']}],[citation],targets),error=>error.code==='AI_INVALID_RESPONSE');
});
