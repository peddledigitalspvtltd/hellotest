const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const context = require('../src/utils/llmTraceContext');
function load(file, overrides = {}) {
  const local = createRequire(file), module = { exports: {} };
  new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id => overrides[id] || local(id), module,module.exports);
  return module.exports;
}
function fixture() {
  const writes = [];
  const capture = load(require.resolve('../src/utils/llmTraceCapture'), { '../obsDb': { pool: { query: async query => { writes.push(query); return {rows:[]}; } } } });
  const client = load(require.resolve('../src/utils/llmHttpClient'), { './llmTraceCapture': capture });
  return { writes, capture, client };
}
test('trace sanitizer redacts secrets and hidden reasoning and bounds payloads without losing JSON structure', () => {
  const f = fixture();
  const result = f.capture.sanitize({ api_key: 'secret', prompt: 'Bearer abcdefghijklmnop', choices:[{message:{reasoning_content:'hidden', content:'Observed result'}}], tool:'{"password":"secret"}', huge:'x'.repeat(150000) });
  const text = JSON.stringify(result.payload);
  assert.doesNotMatch(text, /secret|hidden|abcdefghijklmnop/); assert.match(text,/Observed result/);
  assert.ok(result.truncated); assert.ok(result.redacted); assert.ok(text.length < 97000);
});
test('concurrent call scopes remain isolated and integration selection supplies background project identity', async () => {
  const integration = {};
  context.bindIntegration(integration, {projectId:'background',userId:'worker-user',usageKey:'story.generate'});
  assert.equal(context.current(integration).project_id,'background');
  const results = await Promise.all(['a','b'].map(project => context.run({project_id:project,run_id:`run-${project}`}, async () => { await new Promise(resolve => setTimeout(resolve,project==='a'?8:1)); return context.current(); })));
  assert.deepEqual(results.map(row=>row.project_id),['a','b']); assert.deepEqual(results.map(row=>row.run_id),['run-a','run-b']);
  assert.equal(context.current().run_id,undefined);
});
test('capture preserves the readable provider response, usage and workflow node correlation', async () => {
  const f=fixture();
  await context.run({project_id:'p',actor_id:'u',run_id:'r',node_id:'n'}, async()=>{
    const trace=await f.capture.begin({url:'https://user:password@model.example.test/v1?key=secret',init:{body:JSON.stringify({model:'requested',messages:[{role:'user',content:'Review'}]})},options:{operation:'agent.review'}});
    const response=new Response(JSON.stringify({model:'effective',usage:{total_tokens:12},choices:[{message:{content:'Review result'}}]}));
    await f.capture.finish(trace,{response});
    assert.equal((await response.json()).model,'effective'); assert.equal(response.headers.get('x-hellotest-llm-trace-id'),trace.id);
    assert.equal(f.writes[0].values[5],'r');assert.equal(f.writes[0].values[6],'n');assert.equal(f.writes[0].values[12],'https://model.example.test');
    assert.equal(f.writes[1].values[1],'succeeded');assert.deepEqual(f.writes[1].values[6],{total_tokens:12});
  });
});
test('invalid and missing responses retain explicit failures, not fabricated usage', async()=>{
  const f=fixture();
  await context.run({project_id:'p'},async()=>{
    const trace=await f.capture.begin({url:'https://llm.test',init:{body:'{}'},options:{}});
    await f.capture.finish(trace,{error:Object.assign(new Error('credential detail must not be stored'),{code:'TIMEOUT'})});
    assert.equal(f.writes[1].values[1],'failed');assert.equal(f.writes[1].values[6],null);assert.equal(f.writes[1].values[9],'TIMEOUT');
    assert.doesNotMatch(JSON.stringify(f.writes),/credential detail/);
  });
});
