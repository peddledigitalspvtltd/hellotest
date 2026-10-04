const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../../backend/services/qualityAssistance.service');
const localRequire = createRequire(filename);
function fixture(access) {
  const queries = [], models = [], module = {exports:{}};
  new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>{
    if(id.endsWith('/entityScope.service')) return {requireEntityPermission:async()=>({projectId:'project'})};
    if(id.endsWith('/optionalEvidenceAccess.service')) return {getOptionalEvidenceAccess:async()=>access};
    if(id.endsWith('/db')) return {prepare(sql){queries.push(sql); return {get:async()=>({id:'run',name:'Checkout run'}),all:async()=>{
      if(/attachments/.test(sql)) assert.fail('Denied attachments must never be fetched');
      return [{id:'failed-attempt',test_case_id:'case',status:'failed',error:'Expected confirmation did not match'}, {id:'retry',test_case_id:'case',status:'passed'}];
    }};}};
    if(id === './structuredReview.service') return {invalid:()=>new Error('invalid'),review:async input=>{
      models.push(input.evidence);
      const result=input.validate({summary:'Investigate the observed assertion mismatch.',clusters:input.evidence.clusters.map(item=>({...item,explanation:'The recorded assertion failed; product and test causes require comparison.',recommended_action:'Compare the original expected and actual outcomes.'}))});
      return {result,generation_mode:'llm'};
    }};
    return localRequire(id);
  },module,module.exports);
  return {service:module.exports,queries,models};
}
test('failure reviews enforce result access before any evidence read',async()=>{
  const f=fixture({'run.view':true,'result.view':false,'attachment.view':false});
  await assert.rejects(f.service.previewFailureClusters({user:{id:'user'},executionId:'run'}),{statusCode:403});
  assert.equal(f.queries.length,0);assert.equal(f.models.length,0);
});
test('failure hypotheses preserve recorded failures and omit denied attachments',async()=>{
  const f=fixture({'run.view':true,'result.view':true,'attachment.view':false});
  const result=await f.service.previewFailureClusters({user:{id:'user'},executionId:'run'});
  assert.equal(result.total_results,2);assert.equal(result.failed_or_blocked_results,1);
  assert.equal(result.clusters[0].confidence,null);assert.equal(result.clusters[0].count,1);
  assert.deepEqual(result.clusters[0].evidence_refs,['execution-result:failed-attempt']);
  assert.equal(f.models.length,1);assert.doesNotMatch(JSON.stringify(f.models),/attachment:/);
  assert.ok(f.queries.some(sql=>/LIMIT 2001/.test(sql)));
});
