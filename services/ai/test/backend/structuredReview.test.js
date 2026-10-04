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
      calls.push({url,init,policy}); const value = responses[Math.min(calls.length - 1, responses.length - 1)];
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
