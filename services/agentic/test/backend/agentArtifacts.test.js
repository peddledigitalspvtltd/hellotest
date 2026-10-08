const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeArtifacts,followup}=require('../../backend/services/agentArtifacts');
const citations=[{id:'K-story-1'}],review={findings:[{title:'Ambiguous acceptance criteria',detail:'Clarify the story'}],recommendations:['Improve the story'],citation_ids:['K-story-1']};
test('review chains select one applicable domain specialist using permitted scopes',()=>{
 assert.equal(followup('quality-evaluator',['stories'],review,'Evaluate this story'),'story-architect');
 assert.equal(followup('quality-evaluator',['test-cases'],{...review,findings:[{title:'Coverage gaps'}]},'Review test coverage'),'test-designer');
 assert.equal(followup('failure-analyst',['bugs'],review,'Inspect failures'),'bug-reporter');
 assert.equal(followup('quality-evaluator',[],review,'Evaluate this story'),null);
 assert.equal(followup('story-architect',['stories'],review,'Improve story'),null);
 assert.equal(followup('quality-evaluator',['stories'],{...review,citation_ids:[]},'Review story'),null);
});
test('structured proposals preserve complete domain fields and reject invented citations and empty assertions',()=>{
 const base={title:'Review a run',description:'Proposed recorded run behavior',priority:'P2',citation_ids:['K-story-1']};
 const [story,tc,defect]=normalizeArtifacts([{...base,kind:'story',acceptance_criteria:['Given an authorized user, when the run opens, then outcomes appear.']},{...base,kind:'test_case',prerequisites:['Recorded run exists'],steps:[{action:'Open the recorded run',expected_result:'The outcomes and evidence are displayed'}]},{...base,kind:'defect',reproduction_steps:['Open the run'],expected_result:'Evidence appears',actual_result:'Observed evidence panel is empty',severity:'high'}],citations);
 assert.equal(story.acceptance_criteria.length,1);assert.match(tc.steps[0].expected_result,/evidence/);assert.equal(defect.severity,'high');
 assert.throws(()=>normalizeArtifacts([{...story,citation_ids:['made-up']}],citations),e=>e.code==='AI_INVALID_RESPONSE');
 assert.throws(()=>normalizeArtifacts([{...tc,steps:[{action:'Open',expected_result:''}]}],citations),e=>e.code==='AI_INVALID_RESPONSE');
});
