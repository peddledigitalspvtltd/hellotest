const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../../backend/services/qualityCoverageRules');
function fixture() {
  const story={id:'s',updated_at:'v1',acceptance_criteria:['Audit event must be recorded'],test_case_ids:['t']};
  const step={id:'step',action:'Cancel policy',expected_result:'Audit event exists',step_type:'manual'};
  const spec={id:'t',title:'Cancel policy',updated_at:'v1',steps:[step]};
  const snapshot={complete:true,scope:{build:'b1',environment_id:'qa'},stories:[story],tests:[spec],runs:[{id:'r',build:'b1',test_environment_id:'qa'}],attempts:[],assertion_reviews:[]};
  const review={id:'review',obligation_id:rules.obligationId(story,0),story_revision:rules.storyRevision(story),test_case_id:'t',test_revision:rules.testRevision(spec),step_id:'step',assertion_hash:rules.assertionHash(step),decision:'approved',reviewed_by:'qa',verifier_version:'reviewed-assertion/1'};
  const attempt={id:'a',execution_id:'r',test_case_id:'t',status:'passed',specification_hash:rules.specificationHash(spec),assertions:[{hash:rules.assertionHash(step),status:'passed'}]};
  return {snapshot,review,attempt};
}
test('links and case-level green status do not count as assertion coverage',()=>{
  const f=fixture();f.snapshot.attempts=[f.attempt];const result=rules.coverage(f.snapshot);
  assert.equal(result.rows[0].designed,'unknown');assert.equal(result.observed_percent,null);assert.equal(result.unknown_weight,1);
});
test('human assertion review establishes only designed coverage until the exact test and build execute',()=>{
  const f=fixture();f.snapshot.assertion_reviews=[f.review];let result=rules.coverage(f.snapshot);
  assert.equal(result.designed_percent,100);assert.equal(result.executable_percent,null);assert.equal(result.observed_percent,null);
  f.snapshot.attempts=[f.attempt];result=rules.coverage(f.snapshot);assert.equal(result.observed_percent,100);assert.equal(result.executable_percent,100);
  f.snapshot.runs[0].build='other';assert.equal(rules.coverage(f.snapshot).observed_percent,null);
});
test('changed criterion, changed assertion and revoked review invalidate coverage',()=>{
  for(const change of ['story','step','revoke','actor']) {
    const f=fixture();f.snapshot.assertion_reviews=[f.review];f.snapshot.attempts=[f.attempt];
    if(change==='story')f.snapshot.stories[0].updated_at='v2';
    if(change==='step')f.snapshot.tests[0].steps[0].expected_result='Any response';
    if(change==='revoke')f.review.decision='revoked';
    if(change==='actor')f.review.reviewed_by=null;
    assert.notEqual(rules.coverage(f.snapshot).rows[0].designed,'covered');
  }
});
test('a matching assertion in an old test specification does not establish current coverage',()=>{
  const f=fixture();f.snapshot.tests[0].steps.push({id:'cleanup',action:'Reset fixtures',expected_result:'No contamination'});
  f.review.test_revision=rules.testRevision(f.snapshot.tests[0]);f.snapshot.assertion_reviews=[f.review];f.snapshot.attempts=[f.attempt];
  assert.equal(rules.coverage(f.snapshot).designed_percent,100);assert.equal(rules.coverage(f.snapshot).observed_percent,null);
});
test('failing mapped assertions survive passing retries; unrelated build failures do not contaminate the selected build',()=>{
  const f=fixture();f.snapshot.assertion_reviews=[f.review];f.snapshot.attempts=[f.attempt,{...f.attempt,id:'failed',status:'failed',assertions:[{hash:f.review.assertion_hash,status:'failed'}]}];
  assert.equal(rules.coverage(f.snapshot).rows[0].observed,'failed');assert.equal(rules.coverage(f.snapshot).observed_percent,0);
  f.snapshot.attempts[1].execution_id='old';f.snapshot.runs.push({id:'old',build:'b0',test_environment_id:'qa'});
  assert.equal(rules.coverage(f.snapshot).observed_percent,100);
});
test('partial inventory never produces a complete denominator',()=>{
  const f=fixture();f.snapshot.assertion_reviews=[f.review];f.snapshot.coverage_complete=false;
  assert.equal(rules.coverage(f.snapshot).designed_percent,null);assert.equal(rules.coverage(f.snapshot).denominator_complete,false);
});
