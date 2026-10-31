const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../../backend/services/structuredReview.service');
const localRequire = createRequire(filename);
function fixture(responses, integration = { id: 'llm', model: 'reviewer', is_active: true }) {
  const calls = [], module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => {
    if (id.endsWith('/aiLlmSelection.service')) return { resolveLlmIntegrationForUsage: async () => integration };
    if (id.endsWith('/llmHttpClient')) return { fetchLlmWithRetry: async (url, init, policy) => {
      calls.push({url,init,policy}); const selected = responses[Math.min(calls.length - 1, responses.length - 1)],value=typeof selected==='function'?await selected(policy):selected;
      if (value instanceof Error) throw value;
      return new Response(JSON.stringify(value));
    }};
    return localRequire(id);
  }, module, module.exports);
  const input = { projectId: 'p', task: 'Review', evidence: {id:'e1'}, contract: '{"ref":"e1"}', validate: value => { if (value.ref !== 'e1') throw module.exports.invalid(); return value; } };
  return {service:module.exports,calls,input};
}
const output = (content, finish_reason='stop') => ({model:'effective-reviewer',choices:[{finish_reason,message:{content}}]});
test('structured review repairs once within one deadline and records the accepted model', async () => {
  const f=fixture([output('{broken'),output('{"ref":"e1"}')]);
  const result=await f.service.review(f.input);
  assert.equal(result.result.ref,'e1'); assert.equal(result.model_execution.model_calls,2);
  assert.equal(result.model_execution.effective_model,'effective-reviewer');
  assert.equal(result.model_execution.input_hash.length,64);
  assert.ok(f.calls[1].policy.timeoutMs<=f.calls[0].policy.timeoutMs);
  assert.ok(f.calls.every(call=>call.policy.maxAttempts===1 && !call.policy.compatibility && !call.policy.contextFallback));
  const first=JSON.parse(f.calls[0].init.body),second=JSON.parse(f.calls[1].init.body);
  assert.ok(second.messages.some(message=>message.role==='assistant'&&message.content==='{broken'));
  assert.match(second.messages.at(-1).content,/AI_RESPONSE_JSON_INVALID/);
  assert.notEqual(first.messages.at(-1).content,second.messages.at(-1).content);
  assert.equal(second.messages.map(message=>message.content).join('\n').split(f.input.contract).length-1,1,'Repair keeps the response contract once.');
});
test('structured review rejects forged references after the bounded repair', async()=>{
  const f=fixture([output('{"ref":"invented"}')]);
  await assert.rejects(f.service.review(f.input),{code:'AI_ASSESSMENT_FAILED'});assert.equal(f.calls.length,2);
});
test('truncated JSON never becomes an accepted review even when it parses',async()=>{
  const f=fixture([output('{"ref":"e1"}','length')]);
  await assert.rejects(f.service.review(f.input),{code:'AI_OUTPUT_TRUNCATED'});assert.equal(f.calls.length,1);
});
test('missing model and oversized evidence stop before transport',async()=>{
  const missing=fixture([],null);await assert.rejects(missing.service.review(missing.input),{code:'AI_MODEL_REQUIRED'});assert.equal(missing.calls.length,0);
  const large=fixture([]);await assert.rejects(large.service.review({...large.input,evidence:{content:'x'.repeat(48001)}}),{code:'AI_INPUT_BUDGET_EXCEEDED'});assert.equal(large.calls.length,0);
});
test('a local correction retains the already selected reduced evidence instead of resending rejected full input',async()=>{
 const f=fixture([policy=>{policy.onContextFallback();return output('{"ref":"forged"}');},output('{"ref":"e1"}')]);
 const fallbackEvidence={id:'e1',content:'REDUCED_EVIDENCE'};
 const result=await f.service.review({...f.input,usageKey:'ai.requirement.gherkin',evidence:{id:'e1',content:'FULL_EVIDENCE'},fallbackEvidence});
 const retry=JSON.parse(f.calls[1].init.body);
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].policy.contextFallback,false);
 assert.match(retry.messages[0].content,/HELLOTEST_AI:ai\.requirement\.gherkin:structuredReview/);
 assert.doesNotMatch(JSON.stringify(retry),/FULL_EVIDENCE|ai\.quality\.portfolio_insights/);
 assert.match(JSON.stringify(retry),/REDUCED_EVIDENCE/);
 assert.equal(result.model_execution.input_hash,require('node:crypto').createHash('sha256').update(JSON.stringify(fallbackEvidence)).digest('hex'));
});
test('fallback evidence is sanitized and invalid output larger than the repair budget is described without a partial JSON replay',async()=>{
 const f=fixture([output('{"ref":"'+ 'x'.repeat(17000)+'"}'),output('{"ref":"e1"}')]);
 await f.service.review({...f.input,fallbackEvidence:{id:'e1',content:'api_key=private-value'}});
 assert.doesNotMatch(f.calls[0].policy.contextFallbackContent,/private-value/);
 const candidate=JSON.parse(JSON.parse(f.calls[1].init.body).messages.find(message=>message.role==='assistant').content);
 assert.equal(candidate.omitted,true);assert.equal(candidate.reason,'invalid_output_exceeds_repair_budget');assert.equal(candidate.sha256.length,64);
});
test('shared transport response-validation errors receive the same single actionable correction',async()=>{
 for(const code of ['AI_INVALID_JSON','AI_OUTPUT_SCHEMA_VIOLATION','AI_MANAGED_SCHEMA_INVALID']){
  const error=Object.assign(new Error('The response failed its schema.'),{code,validation_errors:[{path:'/ref',keyword:'enum'}]});
  Object.defineProperty(error,'model_candidate',{value:'{"ref":"wrong"}',enumerable:false});
  const f=fixture([error,output('{"ref":"e1"}')]);
  assert.equal((await f.service.review(f.input)).result.ref,'e1');assert.equal(f.calls.length,2);
  const messages=JSON.parse(f.calls[1].init.body).messages;
  assert.equal(messages.find(message=>message.role==='assistant').content,'{"ref":"wrong"}');assert.match(messages.at(-1).content,/\/ref/);
 }
 for(const code of ['AI_OUTPUT_SCHEMA_INVALID','AI_OUTPUT_TRUNCATED','AI_PROVIDER_REFUSAL']){
  const f=fixture([Object.assign(new Error('Non-repairable response.'),{code})]);
  await assert.rejects(f.service.review(f.input),{code});assert.equal(f.calls.length,1);
 }
});
