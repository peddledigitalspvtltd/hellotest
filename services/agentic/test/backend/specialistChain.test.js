const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/agenticAssistant.service.js');
function fixture({ reviewPatch = {}, failKind = null } = {}){
 const native=createRequire(filename),orchestrator=native('@hellotest/ai/backend/services/aiContextOrchestrator.service');
 const events=[],requests=[];let transaction={id:'review',metadata:{}};
 const citation={id:'K-live-stories-1',scope:'stories',label:'Approved checkout story',source_kind:'authoritative_live_stories'};
 const reviewer={headline:'Clarify checkout acceptance',executive_summary:'The story omits retry behavior.',response:'The approved story needs retry acceptance criteria [K-live-stories-1].',activity_summary:'Reviewed the story.',findings:[{title:'Retry acceptance is missing',detail:'Define the observable retry behavior.',priority:'high',citation_ids:[citation.id]}],deliverables:[],recommendations:['Complete this story with retry acceptance criteria.'],assumptions:[],evidence_gaps:[],suggested_handoffs:['story-architect'],citation_ids:[citation.id],evaluation:{grounding:80,completeness:80,traceability:80,risk_control:80,maturity_score:80,rationale:'Source-supported proposal'}};
 Object.assign(reviewer, reviewPatch);
 const author={...reviewer,headline:'Completed story proposal',response:'Review the proposed retry boundary [K-live-stories-1].',recommendations:['Review and apply the completed story proposal.'],artifacts:[{kind:'story',target_id:'story-checkout',title:'Checkout retry',description:'Proposed behavior: a retry preserves one order.',priority:'P2',citation_ids:[citation.id],acceptance_criteria:['Given a pending checkout, when the request is retried, then one order remains.']}]};
 const mocks={
  '@hellotest/platform/backend/services/optionalEvidenceAccess.service':{getOptionalEvidenceAccess:async(u,p,codes)=>Object.fromEntries(codes.map(c=>[c,true]))},
  '../agents/agentRegistry.service':{resolveModel:async()=>({id:'model',name:'Fixture model',model:'test-model',base_url:'https://model.fixture/v1',is_active:true})},
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},
  '@hellotest/platform/backend/public/projectAccess':{getProject:async()=>({id:'p'})},
  '@hellotest/platform/backend/services/workspaceTransaction.service':{createTransaction:async input=>(transaction={...input,id:'review'}),appendTransactionEvent:async(id,event)=>events.push(event),updateTransaction:async(id,input)=>(transaction={...transaction,...input,metadata:{...transaction.metadata,...input.metadata}}),listTransactionEvents:async()=>events},
  '@hellotest/ai/backend/services/aiContextOrchestrator.service':{...orchestrator,buildLiveProjectEvidence:async()=>({hits:[{chunk_id:citation.id,title:'Approved checkout story',source_kind:'live_project',content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',records:[{id:'story-checkout',title:'Checkout',description:'Checkout creates one order.',revision:3}]}),citation}],counts:{stories:1}})},
  '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,init)=>{requests.push(JSON.parse(init.body));return Response.json({model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(requests.length===1?reviewer:(()=>{const payload=JSON.parse(requests.at(-1).messages.at(-1).content);const kind=payload.requested_outcome.kind;if(kind===failKind)return {...author,artifacts:[]};if(kind==='story')return author;return {...author,artifacts:[kind==='test_case'?{kind,title:'Retry one order',description:'Verify checkout retries',priority:'P2',citation_ids:[citation.id],prerequisites:['Checkout is pending'],steps:[{action:'Retry checkout',expected_result:'One order is retained'}]}:{kind,title:'Duplicate order observed',description:'Observed duplicate orders',priority:'P2',citation_ids:[citation.id],reproduction_steps:['Retry checkout'],expected_result:'One order',actual_result:'Two orders observed',severity:'high'}]};})())}}]},{headers:{'x-hellotest-llm-trace-id':`trace-${requests.length}`}});}}
 };
 const module={exports:{}};new Function('require','module','exports','__filename','__dirname',fs.readFileSync(filename,'utf8'))(id=>mocks[id]||native(id),module,module.exports,filename,path.dirname(filename));
 return {service:module.exports,requests,events,reviewer,author};
}
test('a real specialist service chains the review into an authoring call with original evidence and complete structured output',async()=>{
 const f=fixture();const reply=await f.service.respond({project_id:'p',user:{id:'u'},agent_id:'quality-evaluator',context_scopes:['stories'],prompt:'Evaluate this story and complete its missing acceptance criteria.'});
 assert.equal(f.requests.length,2);assert.equal(reply.result.model_execution.model_calls,2);assert.deepEqual(reply.result.agent_chain.map(a=>a.agent_id),['quality-evaluator','story-completion']);assert.equal(reply.result.artifacts[0].kind,'story');assert.equal(reply.result.artifacts[0].target_id,'story-checkout');assert.equal(reply.result.artifacts[0].target_revision,3);assert.equal(reply.result.artifacts[0].acceptance_criteria.length,1);assert.ok(reply.result.recommendations.includes(f.author.recommendations[0]));
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
