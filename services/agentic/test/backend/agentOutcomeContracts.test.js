const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeArtifacts,outcomeContract,outcomeIssues,planFollowups}=require('../../backend/services/agentArtifacts');
const definition=require('../../backend/agents/agentDefinition');
const profiles=require('../../shared/workflowSpecialists.json');
const catalog=require('../../shared/agentOutcomeContracts.json');
const citations=[{id:'case-source'}],base={title:'Retry once',description:'Verify the approved retry boundary.',priority:'P2',citation_ids:['case-source']};
const caseDraft={...base,kind:'test_case',test_case_type:'functional',parameter_values:{'t.email':'reviewed@example.test'},steps:[{action:'Enter @t.email and retry the request.',expected_result:'One request remains.'}]};
const finding={id:'finding-1',title:'Missing test coverage',detail:'Add a Test Case for the approved retry boundary.',citation_ids:['case-source']};
const review=(extra={})=>({response:'Observed the recorded behavior.',citation_ids:['case-source'],findings:[],artifacts:[],evidence_gaps:[],...extra});

test('scoped native automation context supplies exact manual linkage targets without treating automation as manual',()=>{
 const citation={id:'K-automation-case'};
 const item={source_kind:'authoritative_live_automation',citation,content:JSON.stringify({case:{id:'selected-manual',automated:'no',title:'Source intent'},linked_manual_cases:[{id:'linked-manual',title:'Linked intent'}]})};
 const targets=require('../../backend/services/agentArtifacts').storyTargets({automation_case:[item]});
 assert.deepEqual(targets.map(target=>target.id),['selected-manual','linked-manual']);assert.ok(targets.every(target=>target.citation_id===citation.id));
 item.content=JSON.stringify({case:{id:'automated-case',automated:'yes'},linked_manual_cases:[]});assert.deepEqual(require('../../backend/services/agentArtifacts').storyTargets({automation_case:[item]}),[]);
 item.content=JSON.stringify({evidence_permissions:['requirement.view'],stories:{stories:[{id:'linked-story'}],related_stories:[{id:'neighbor-story'}]}});
 assert.deepEqual(require('../../backend/services/agentArtifacts').storyTargets({automation_case:[item]}),[{id:'linked-story',kind:'story_link',citation_id:citation.id}]);
 item.content=JSON.stringify({stories:{stories:[{id:'ungranted-story'}]}});assert.deepEqual(require('../../backend/services/agentArtifacts').storyTargets({automation_case:[item]}),[]);
 assert.deepEqual(require('../../backend/services/agentArtifacts').storyTargets({task_input:[{...item,source_kind:'task_input',content:JSON.stringify({case:{id:'unverified',automated:'no'}})}]}),[]);
});

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

test('independent authoring does not falsely claim to resolve an analysis-only runtime-evidence gap',()=>{
 const analysis={...finding,requires_proposal:false,artifact_kind:'test_case',citation_ids:['runtime-source'],detail:'Current browser runtime evidence is unavailable.'};
 const standalone={...caseDraft,addressed_finding_ids:[]};
 const contract=outcomeContract('test-designer');
 assert.deepEqual(outcomeIssues(review({findings:[analysis],artifacts:[standalone]}),contract),[]);
 const [issue]=outcomeIssues(review({findings:[analysis],artifacts:[{...standalone,addressed_finding_ids:['finding-1']}]}),contract);
 assert.equal(issue.code,'AGENT_OUTCOME_FINDING_REFERENCE_INVALID');
 assert.equal(issue.path,'artifacts[0].addressed_finding_ids');
 assert.equal(issue.issue,'finding_supporting_citation_required');
 assert.deepEqual(issue.required_citation_ids,['runtime-source']);
 assert.match(issue.message,/addressed_finding_ids:\[\]/);
 const missing=outcomeIssues(review({artifacts:[{...standalone,addressed_finding_ids:['absent']}]}),contract)[0];
 assert.equal(missing.issue,'recorded_finding_id_required');
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

test('a correction identifies every missing case metadata field in one response',()=>{
 const {test_case_type,parameter_values,...missing}=caseDraft;
 assert.throws(()=>normalizeArtifacts([missing],citations,[],{requireMetadata:true}),error=>{
  assert.deepEqual(error.validation_errors,[{path:'artifacts[0].test_case_type',keyword:'required',required_property:'test_case_type'},{path:'artifacts[0].parameter_values',keyword:'required',required_property:'parameter_values'}]);
  return error.code==='AI_INVALID_RESPONSE';
 });
});

test('unsupported type and parameter diagnostics point to exact native fields without exposing values',()=>{
 for(const [changed,path,keyword]of [[{...caseDraft,test_case_type:'API Test'},'test_case_type','supported_type_slug_required'],[{...caseDraft,test_case_type:'retired'},'test_case_type','application_contract_type_required'],[{...caseDraft,parameter_values:{'s.private':'PRIVATE_VALUE'}},'parameter_values','unique_case_owned_text_parameters_required']]){
  assert.throws(()=>normalizeArtifacts([changed],citations,[],{requireMetadata:true,testCaseTypes:['functional']}),error=>{
   assert.deepEqual(error.validation_errors,[{path:`artifacts[0].${path}`,keyword}]);assert.doesNotMatch(JSON.stringify(error.validation_errors),/PRIVATE_VALUE/);return true;
  });
 }
 assert.deepEqual(normalizeArtifacts([{...caseDraft,parameter_values:{id:'fixture-1'}}],citations,[],{requireMetadata:true})[0].parameter_values,{'t.id':'fixture-1'});
});

test('invalid native target references identify each proposal field before correction',()=>{
 const automation={...caseDraft,kind:'automation',start_url:'https://fixture.test/',manual_test_case_ids:['unknown-case']};
 const run={...base,kind:'run',priority:'P2',test_case_ids:['unknown-case'],exit_criteria:['Every selected case passes.']};
 for(const [artifact,field]of [[{...caseDraft,requirement_ids:['unknown-story']},'requirement_ids'],[automation,'manual_test_case_ids'],[run,'test_case_ids']])assert.throws(()=>normalizeArtifacts([artifact],citations,[],{requireMetadata:true}),error=>error.code==='AI_INVALID_RESPONSE'&&error.validation_path===`artifacts[0].${field}`&&error.validation_errors[0].path===`artifacts[0].${field}`);
});

test('a no-change conclusion with positive findings gets exact corrective guidance rather than a required-draft loop',()=>{
 const issues=outcomeIssues(review({no_changes_required:true,findings:[{...finding,requires_proposal:false,title:'Story is complete'}]}),outcomeContract('story-completion'));
 const conflict=issues.find(issue=>issue.code==='AGENT_OUTCOME_NO_CHANGE_CONFLICT');
 assert.equal(conflict.path,'no_changes_required');assert.match(conflict.message,/findings:\[\]/);
 assert.deepEqual(outcomeIssues(review({no_changes_required:true,findings:[]}),outcomeContract('story-completion')),[]);
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
