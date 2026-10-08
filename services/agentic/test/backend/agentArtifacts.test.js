const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeArtifacts,followup,planFollowups,storyTargets,remainingRecommendations}=require('../../backend/services/agentArtifacts');
const citations=[{id:'K-story-1'}],review={findings:[{title:'Ambiguous acceptance criteria',detail:'Clarify the story',citation_ids:['K-story-1']}],recommendations:['Improve the story'],citation_ids:['K-story-1']};
test('review chains select one applicable domain specialist using permitted scopes',()=>{
 assert.equal(followup('quality-evaluator',['stories'],review,'Evaluate this story'),'story-completion');
 assert.equal(followup('quality-evaluator',['test-cases'],{...review,findings:[{title:'Coverage gaps',detail:'Missing test assertions',citation_ids:['K-story-1']}]},'Review test coverage'),'test-designer');
 assert.equal(followup('failure-analyst',['bugs'],{...review,findings:[{title:'Failed checkout',detail:'Reproducible failure needs a defect',citation_ids:['K-story-1']}]},'Inspect failures'),'bug-reporter');
 assert.equal(followup('quality-evaluator',[],review,'Evaluate this story'),null);
 assert.equal(followup('story-architect',['stories'],review,'Improve story'),'story-completion');
 assert.equal(followup('quality-evaluator',['stories'],{...review,citation_ids:[]},'Review story'),null);
});
test('structured proposals preserve complete domain fields and reject invented citations and empty assertions',()=>{
 const base={title:'Review a run',description:'Proposed recorded run behavior',priority:'P2',citation_ids:['K-story-1']};
 const [story,tc,defect]=normalizeArtifacts([{...base,kind:'story',acceptance_criteria:['Given an authorized user, when the run opens, then outcomes appear.']},{...base,kind:'test_case',prerequisites:['Recorded run exists'],steps:[{action:'Open the recorded run',expected_result:'The outcomes and evidence are displayed'}]},{...base,kind:'defect',reproduction_steps:['Open the run'],expected_result:'Evidence appears',actual_result:'Observed evidence panel is empty',severity:'high'}],citations);
 assert.equal(story.acceptance_criteria.length,1);assert.match(tc.steps[0].expected_result,/evidence/);assert.equal(defect.severity,'high');
 assert.throws(()=>normalizeArtifacts([{...story,citation_ids:['made-up']}],citations),e=>e.code==='AI_INVALID_RESPONSE');
 assert.throws(()=>normalizeArtifacts([{...tc,steps:[{action:'Open',expected_result:''}]}],citations),e=>e.code==='AI_INVALID_RESPONSE');
});

test('handoff planning handles multiple domain gaps, skips fulfilled outputs and excludes repository/browser agents',()=>{
 const r={...review,findings:[{title:'Missing acceptance, coverage and defect details',detail:'Complete the story, add tests and record the observed failure.',citation_ids:['K-story-1']}]};
 assert.deepEqual(planFollowups('quality-orchestrator',['stories','test-cases','bugs'],r).map(p=>p.agent_id),['story-completion','test-designer','bug-reporter']);
 assert.equal(planFollowups('quality-orchestrator',['stories'],{...r,artifacts:[{kind:'story'}]}).length,0);
 assert.equal(planFollowups('repository-curator',['stories','test-cases','bugs'],r).length,0);
 assert.equal(planFollowups('browser-web',['stories'],r).length,0);
 assert.equal(planFollowups('agent-saved-review',['stories'],r)[0].agent_id,'story-completion');
 assert.equal(planFollowups('quality-evaluator',['stories'],{...review,findings:[{title:'No gaps found',detail:'Story is complete.',citation_ids:['K-story-1']}]}).length,0);
 assert.equal(planFollowups('quality-evaluator',['stories'],{...review,findings:[{title:'Missing acceptance',citation_ids:['invented']}]}).length,0);
});

test('existing Story targets bind to exact live evidence and server-recorded revisions',()=>{
 const context={live_project:[{source_kind:'live_project',citation:{id:'K-story-1'},content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',records:[{id:'story-1',title:'Checkout',revision:4}]})},{source_kind:'task_input',citation:{id:'K-user'},content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',records:[{id:'spoofed',revision:1}]})}]};
 const targets=storyTargets(context);assert.deepEqual(targets,[{id:'story-1',title:'Checkout',revision:4,citation_id:'K-story-1'}]);
 const draft={kind:'story',title:'Checkout',description:'Preserved checkout intent.',acceptance_criteria:['Given a retry, when checkout repeats, then one order is retained.'],citation_ids:['K-story-1'],target_id:'story-1',target_revision:999};
 assert.equal(normalizeArtifacts([draft],citations,targets)[0].target_revision,4);
 assert.throws(()=>normalizeArtifacts([{...draft,target_id:'spoofed'}],citations,targets));
 assert.deepEqual(storyTargets({live_project:[{...context.live_project[0],content:'truncated snapshot'}]}),[]);
});
test('completed authoring removes already performed recommendations and preserves remaining review obligations',()=>{
 assert.deepEqual(remainingRecommendations(['Complete the story acceptance criteria.','Add test cases for retry.','Verify runtime evidence.'],['Review the Story proposal.'],['story']),['Add test cases for retry.','Verify runtime evidence.','Review the Story proposal.']);
});
