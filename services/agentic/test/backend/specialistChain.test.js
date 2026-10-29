const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/agenticAssistant.service.js');
function fixture({ reviewPatch = {}, failKind = null, sequence = [], executionPatch = {}, revokeAfterModel = false } = {}){
 const native=createRequire(filename),orchestrator=native('@hellotest/ai/backend/services/aiContextOrchestrator.service');
 const events=[],requests=[],retrievals=[];let transaction={id:'review',metadata:{}};
 const citation={id:'K-live-stories-1',scope:'stories',label:'Approved checkout story',source_kind:'live_project',source_id:'live-project-p-stories'};
 const reviewer={headline:'Clarify checkout acceptance',executive_summary:'The story omits retry behavior.',response:'The approved story needs retry acceptance criteria [K-live-stories-1].',activity_summary:'Reviewed the story.',findings:[{title:'Retry acceptance is missing',detail:'Define the observable retry behavior.',priority:'high',citation_ids:[citation.id]}],deliverables:[],recommendations:['Complete this story with retry acceptance criteria.'],assumptions:[],evidence_gaps:[],suggested_handoffs:['story-architect'],citation_ids:[citation.id],evaluation:{grounding:80,completeness:80,traceability:80,risk_control:80,maturity_score:80,rationale:'Source-supported proposal'}};
 Object.assign(reviewer, reviewPatch);
 const author={...reviewer,headline:'Completed story proposal',response:'Review the proposed retry boundary [K-live-stories-1].',recommendations:['Review and apply the completed story proposal.'],artifacts:[{kind:'story',target_id:'story-checkout',title:'Checkout retry',description:'Proposed behavior: a retry preserves one order.',priority:'P2',citation_ids:[citation.id],acceptance_criteria:['Given a pending checkout, when the request is retried, then one order remains.']}]};
 const configuration=native('@hellotest/platform/backend/services/aiConfiguration.service');
 const sourceHit={chunk_id:citation.id,title:'Approved checkout story',source_kind:'live_project',source_id:citation.source_id,content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',evidence_permissions:['requirement.view'],records:[{id:'story-checkout',title:'Checkout',description:'Checkout creates one order.',revision:3}]}),citation};
 const mocks={
  '@hellotest/platform/backend/services/dropdownCatalog.service':{getField:async()=>({options:[{value:'functional',active:true},{value:'regression',active:true},{value:'disabled',active:false}]})},
  '@hellotest/platform/backend/services/aiConfiguration.service':{...configuration,resolve:async id=>{const defaults=configuration.catalog.find(item=>item.id===id).defaults;return {config:{...defaults,agent_execution:{...defaults.agent_execution,...executionPatch}}};}},
  '@hellotest/knowledge/backend/services/knowledgeRetrieval.service':{retrieveSearch:async input=>{retrievals.push(input);return {results:[sourceHit],retrieval:{context_transport:'mcp',live_context_counts:{stories:1}}};},authorizeFreshEvidence:async({hits})=>({allowed:hits,denied_ids:[]})},
  '@hellotest/platform/backend/services/optionalEvidenceAccess.service':{getOptionalEvidenceAccess:async(u,p,codes)=>Object.fromEntries(codes.map(c=>[c,!(revokeAfterModel&&requests.length)]))},
  '../agents/agentRegistry.service':{resolveModel:async()=>({id:'model',name:'Fixture model',model:'test-model',base_url:'https://model.fixture/v1',is_active:true})},
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},
  '@hellotest/platform/backend/public/projectAccess':{getProject:async()=>({id:'p'})},
  '@hellotest/platform/backend/services/workspaceTransaction.service':{createTransaction:async input=>(transaction={...input,id:'review'}),appendTransactionEvent:async(id,event)=>events.push(event),updateTransaction:async(id,input)=>(transaction={...transaction,...input,metadata:{...transaction.metadata,...input.metadata}}),listTransactionEvents:async()=>events},
  '@hellotest/ai/backend/services/aiContextOrchestrator.service':{...orchestrator,buildLiveProjectEvidence:async()=>({hits:[{chunk_id:citation.id,title:'Approved checkout story',source_kind:'live_project',content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',records:[{id:'story-checkout',title:'Checkout',description:'Checkout creates one order.',revision:3}]}),citation}],counts:{stories:1}})},
  '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,init)=>{requests.push(JSON.parse(init.body));if(sequence[requests.length-1] instanceof Error)throw sequence[requests.length-1];return Response.json({model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(sequence[requests.length-1] || (requests.length===1?reviewer:(()=>{const payload=JSON.parse(requests.at(-1).messages.at(-1).content);const kind=payload.requested_outcome.kind;if(kind===failKind)return {...author,artifacts:[]};if(kind==='story')return {...author,artifacts:author.artifacts.map(a=>({...a,addressed_finding_ids:payload.requested_outcome.finding_ids||[]}))};return {...author,artifacts:[kind==='test_case'?{kind,test_case_type:'Functional',parameter_values:{},addressed_finding_ids:payload.requested_outcome.finding_ids||[],title:'Retry one order',description:'Verify checkout retries',priority:'P2',citation_ids:[citation.id],prerequisites:['Checkout is pending'],steps:[{action:'Retry checkout',expected_result:'One order is retained'}]}:{kind,addressed_finding_ids:payload.requested_outcome.finding_ids||[],title:'Duplicate order observed',description:'Observed duplicate orders',priority:'P2',citation_ids:[citation.id],reproduction_steps:['Retry checkout'],expected_result:'One order',actual_result:'Two orders observed',severity:'high'}]};})()))}}]},{headers:{'x-hellotest-llm-trace-id':`trace-${requests.length}`}});}}
 };
 const module={exports:{}};new Function('require','module','exports','__filename','__dirname',fs.readFileSync(filename,'utf8'))(id=>mocks[id]||native(id),module,module.exports,filename,path.dirname(filename));
 return {service:module.exports,requests,events,reviewer,author,retrievals};
}
test('a real specialist service chains the review into an authoring call with original evidence and complete structured output',async()=>{
 const f=fixture();const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Evaluate this story and complete its missing acceptance criteria.'});
 assert.equal(f.requests.length,2);assert.deepEqual(reply.result.model_call_records.map(call=>call.trace_id),['trace-1','trace-2']);assert.deepEqual(f.events.filter(event=>event.phase==='model.call').map(event=>event.details?.trace_id||event.metadata?.trace_id),['trace-1','trace-2']);assert.equal(reply.result.model_execution.model_calls,2);assert.deepEqual(reply.result.agent_chain.map(a=>a.agent_id),['quality-evaluator','story-completion']);assert.equal(reply.result.artifacts[0].kind,'story');assert.equal(reply.result.artifacts[0].target_id,'story-checkout');assert.equal(reply.result.artifacts[0].target_revision,3);assert.equal(reply.result.artifacts[0].acceptance_criteria.length,1);assert.ok(reply.result.recommendations.includes(f.author.recommendations[0]));
 const payload=JSON.parse(f.requests[1].messages.at(-1).content);assert.equal(payload.previous_specialist_review.findings[0].title,f.reviewer.findings[0].title);assert.ok(JSON.stringify(payload).includes('K-live-stories-1'));assert.ok(f.events.some(e=>e.phase==='handoff.completed'));
});

test('multiple specialists preserve the original review and pass earlier drafts as proposed context',async()=>{
 const f=fixture({reviewPatch:{findings:[{title:'Missing acceptance and test coverage',detail:'The story has no retry boundary, no tests and an observed duplicate-order defect.',priority:'high',citation_ids:['K-live-stories-1']}],recommendations:['Complete the story, add tests and prepare the observed defect.']}});
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-orchestrator',context_scopes:['stories','test-cases','bugs'],prompt:'Assess checkout delivery.'});
 assert.equal(f.requests.length,4);
 assert.deepEqual(reply.result.artifacts.map(a=>a.kind),['story','test_case','defect']);
 assert.deepEqual(reply.result.agent_chain.map(a=>a.agent_id),['quality-orchestrator','story-completion','test-designer','bug-reporter']);
 const third=JSON.parse(f.requests[2].messages.at(-1).content);
 assert.equal(third.previous_specialist_review.findings[0].title,'Missing acceptance and test coverage');
 assert.equal(third.completed_proposals[0].kind,'story');
 assert.ok(reply.result.agent_chain.every(a=>a.status==='completed'));
});
test('a failed follow-up preserves primary findings and permits independent follow-ups to finish',async()=>{
 const f=fixture({failKind:'story',reviewPatch:{findings:[{title:'Missing story acceptance and test coverage',detail:'Define retry criteria and test assertions.',priority:'high',citation_ids:['K-live-stories-1']}]}});
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories','test-cases'],prompt:'Review checkout.'});
 assert.equal(reply.result.agent_chain[1].status,'needs_input');assert.equal(reply.result.agent_chain[2].status,'completed');
 assert.equal(reply.result.artifacts[0].kind,'test_case');assert.equal(reply.result.findings[0].title,f.reviewer.findings[0].title);
 assert.ok(reply.result.evidence_gaps.some(g=>g.includes('could not produce')));
});

test('object-shaped output receives concrete bounded revision feedback before any final outcome is exposed',async()=>{
 const sequence=[],f=fixture({sequence});
 const valid={...f.reviewer,findings:[],recommendations:[]};
 sequence.push({...valid,response:{private_model_shape:'not display text'}},valid);
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Review the checkout evidence.'});
 assert.equal(f.requests.length,2);assert.equal(reply.result.response,valid.response);
 const second=JSON.parse(f.requests[1].messages.at(-1).content);
 assert.equal(second.request,'Review the checkout evidence.');
 assert.deepEqual(second.revision_feedback.issues,[{path:'response',issue:'nonempty_string_required'}]);
 assert.equal(second.revision_feedback.draft_status,'untrusted_proposal');
 assert.ok(f.events.some(event=>event.phase==='outcome.revision'));
 assert.doesNotMatch(JSON.stringify(reply.result),/\[object Object\]/);
});
test('an author must revise comments into the promised complete Story proposal with finding coverage',async()=>{
 const sequence=[],f=fixture({sequence});
 sequence.push(f.reviewer,{...f.author,artifacts:f.author.artifacts.map(item=>({...item,addressed_finding_ids:['finding-1']}))});
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'story-architect',context_scopes:['stories'],prompt:'Create a checkout Story proposal.'});
 assert.equal(f.requests.length,3);assert.equal(reply.result.verification.status,'passed');
 assert.equal(reply.result.artifacts[0].target_revision,3);
 assert.deepEqual(reply.result.artifacts[0].addressed_finding_ids,['finding-1']);
 const feedback=JSON.parse(f.requests[1].messages.at(-1).content).revision_feedback;
 assert.ok(feedback.issues.some(issue=>issue.code==='AGENT_OUTCOME_PROPOSAL_REQUIRED'));
 assert.equal(reply.result.agent_chain.at(-1).agent_id,'story-completion');
 assert.equal(reply.result.artifacts.length,1,'The refined proposal replaces the original draft');
});

test('required Story refinement cannot fall back to the primary draft when the successor fails',async()=>{
 const sequence=[],f=fixture({sequence});
 sequence.push({...f.author,artifacts:f.author.artifacts.map(item=>({...item,addressed_finding_ids:['finding-1']}))},new Error('Provider unavailable'));
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'story-architect',context_scopes:['stories'],prompt:'Improve the selected Story.',inputs:{story_id:'story-checkout'}});
 assert.equal(reply.result.agent_chain.at(-1).status,'needs_input');
 assert.equal(reply.result.artifacts.length,0);
 assert.equal(reply.result.verification.status,'needs_input');
 assert.equal(reply.result.primary_review.findings.length,1);
});
test('a repeated invalid model draft stops instead of spending all remaining calls',async()=>{
 const sequence=[],f=fixture({sequence});const invalid={...f.reviewer,response:{invalid:true}};sequence.push(invalid,invalid,invalid);
 await assert.rejects(f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Review checkout.'}),error=>error.code==='AGENT_OUTPUT_INVALID');
 assert.equal(f.requests.length,2);
});
test('published execution policy can forbid additional model corrections',async()=>{
 const sequence=[],f=fixture({sequence,executionPatch:{max_model_calls:1,max_revision_rounds:0,max_followups:0}});sequence.push({...f.reviewer,response:null});
 await assert.rejects(f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Review checkout.'}),error=>error.code==='AGENT_OUTPUT_INVALID');
 assert.equal(f.requests.length,1);
});
test('specific missing product evidence yields an honest incomplete author outcome without invented drafts',async()=>{
 const sequence=[],f=fixture({sequence});sequence.push({...f.reviewer,findings:[],deliverables:[],artifacts:[],recommendations:[],evidence_gaps:['The approved Story does not define whether a timed-out checkout retry may create another order.']});
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'story-architect',context_scopes:['stories'],prompt:'Create a checkout Story.'});
 assert.equal(f.requests.length,1);assert.equal(reply.result.artifacts.length,0);assert.equal(reply.result.verification.status,'needs_input');assert.equal(reply.result.readiness.status,'insufficient_evidence');
});

test('successor repairs missing original finding references before it is marked complete',async()=>{
 const sequence=[],f=fixture({sequence});
 sequence.push(f.reviewer,f.author,{...f.author,artifacts:f.author.artifacts.map(item=>({...item,addressed_finding_ids:['finding-1']}))});
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Review and complete checkout acceptance.'});
 assert.equal(f.requests.length,3);assert.equal(reply.result.verification.status,'passed');
 assert.equal(reply.result.agent_chain[1].status,'completed');
 const payload=JSON.parse(f.requests[2].messages.at(-1).content);
 assert.equal(payload.previous_specialist_review.findings[0].id,'finding-1');
 assert.ok(payload.revision_feedback.issues.some(issue=>issue.code==='AGENT_OUTCOME_FINDING_UNRESOLVED'));
});
test('published schema rejection gets safe concrete revision feedback under the same call budget',async()=>{
 const sequence=[],f=fixture({sequence});
 sequence.push(Object.assign(new Error('PRIVATE VALIDATOR DETAIL'),{code:'AI_MANAGED_SCHEMA_INVALID',validation_errors:[{path:'/response',keyword:'required',required_property:'response',message:'PRIVATE VALIDATOR DETAIL'}]}),{...f.reviewer,findings:[],recommendations:[]});
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Review checkout.'});
 assert.equal(f.requests.length,2);
 const feedback=JSON.parse(f.requests[1].messages.at(-1).content).revision_feedback;
 assert.deepEqual(feedback.issues,[{path:'/response',issue:'required',required_property:'response'}]);
 assert.doesNotMatch(JSON.stringify(feedback),/PRIVATE VALIDATOR/);
 assert.deepEqual(reply.result.model_call_records.map(record=>record.status),['failed','response_received']);
 assert.equal(reply.result.model_execution.usage.total_tokens,null);
});
test('validated draft streams progressively without offering acceptance before the saved final outcome',async()=>{
 const f=fixture(),progress=[];
 const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Review and complete checkout.',onProgress:event=>progress.push(event)});
 const previews=progress.filter(event=>event.phase==='outcome.preview');
 assert.equal(previews.length,2);assert.equal(previews[0].outcome_preview.artifacts.length,0);assert.equal(previews[1].outcome_preview.artifacts[0].kind,'story');
 assert.ok(previews.every(event=>!Object.hasOwn(event.outcome_preview,'verification')));
 assert.equal(reply.transaction.status,'completed');assert.equal(reply.result.verification.status,'passed');
});
test('a final JSON response rechecks evidence permissions even without a progress subscriber',async()=>{
 const sequence=[],f=fixture({sequence,revokeAfterModel:true});sequence.push({...f.reviewer,findings:[],recommendations:[]});
 await assert.rejects(f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Review checkout.'}),error=>error.statusCode===403);
 assert.equal(f.requests.length,1);
});
