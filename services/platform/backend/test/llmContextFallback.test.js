const { sourceFile } = require("./helpers/sourceFile");
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { expandManagedInstructions } = require('./helpers/managedInstructions');
const { fetchLlmWithRetry } = require('../src/utils/llmHttpClient');
const { isContextSizeRejection, buildContextFallbackBody } = require('../src/utils/llmContextFallback');
const { MCP_CONTEXT_PREFIX } = require('../src/utils/llmContextFallback');
const { compactEvidenceText } = require('../src/utils/llmContextFallback');
const { compactMcpContext, retainMcpRelationships } = require('../src/utils/llmContextFallback');

const fullBody = () => JSON.stringify({ model: 'selected-model', temperature: .2, response_format: { type: 'json_object' }, messages: [
  { role: 'system', content: 'Return the required JSON contract. Never invent evidence.' },
  { role: 'user', content: `Story: secure login\n${'long description '.repeat(4000)}` }
] });

test('context-size classification excludes authentication, throttling, malformed schemas and network failures', () => {
  for (const [status, detail] of [[413, ''], [400, 'context_length_exceeded'], [422, 'input tokens exceed the model limit'], [400, 'maximum context length is 4096 tokens']]) {
    assert.equal(isContextSizeRejection(status, detail), true);
  }
  for (const [status, detail] of [[401, 'context_length_exceeded'], [429, 'too many input tokens'], [500, 'payload too large'], [400, 'unknown response_format schema'], [0, 'timeout']]) {
    assert.equal(isContextSizeRejection(status, detail), false);
  }
});

test('a smaller payload preserves model, system instructions and output schema without broken tool conversations', () => {
  const original = fullBody();
  const compact = JSON.parse(buildContextFallbackBody(original, 'Story title: secure login. Return {"testCases":[]} proposals for human review.'));
  assert.equal(compact.model, 'selected-model');
  assert.deepEqual(compact.response_format, { type: 'json_object' });
  assert.equal(compact.messages[0].content, JSON.parse(original).messages[0].content);
  assert.equal(compact.messages.length, 2);
  assert.doesNotMatch(compact.messages[1].content, /long description|data:image/);
  assert.equal(buildContextFallbackBody(JSON.stringify({ messages: [{ role: 'tool', content: 'result' }, { role: 'user', content: 'x'.repeat(9000) }] })), null);
  assert.equal(buildContextFallbackBody('{bad json'), null);
});
test('size correction retains bounded MCP citation provenance and the original task contract', () => {
 const original=JSON.parse(fullBody());
 original.messages.splice(1,0,{role:'user',content:MCP_CONTEXT_PREFIX+JSON.stringify({project_id:'p',evidence:[{evidence_id:'e1',content:'Verified behavior '.repeat(1000),citation:{source_id:'s1',version_hash:'revision-1'}}]})});
 const fallback=JSON.parse(buildContextFallbackBody(JSON.stringify(original),'User request: cover refunds. Story criteria: reject duplicate refunds.'));
 const packet=JSON.parse(fallback.messages[1].content.slice(MCP_CONTEXT_PREFIX.length));
 assert.equal(packet.project_id,'p');assert.equal(packet.evidence[0].evidence_id,'e1');assert.equal(packet.evidence[0].citation.version_hash,'revision-1');
 assert.equal(packet.evidence[0].excerpt_truncated,true);assert.ok(packet.evidence[0].content.length<=500);
 assert.match(fallback.messages.at(-1).content,/cover refunds.*reject duplicate refunds/);
 assert.deepEqual(fallback.response_format,original.response_format);
});
test('structured live evidence remains valid JSON when excerpts are compressed', () => {
 const compact=compactEvidenceText(JSON.stringify({evidence_type:'authoritative_live_story_snapshot',records:Array.from({length:20},(_,i)=>({id:'story-'+i,title:'Refund',description:'Description '.repeat(200),acceptance_criteria:['Reject duplicate refunds']}))}),700);
 assert.ok(compact.length<=700);const snapshot=JSON.parse(compact);assert.equal(snapshot.evidence_type,'authoritative_live_story_snapshot');assert.equal(snapshot.context_window.bounded,true);
 assert.ok(compactEvidenceText('x'.repeat(900),500).length<=500);
});

test('provider size correction retains only delivered graph proofs and never detached or altered witness spans',()=>{
 const content='A depends on B.',hash=require('node:crypto').createHash('sha256').update(content).digest('hex');
 const proof={evidence_id:'proof',content,integrity:{chunk_hash:hash,evidence_hash:hash}};
 const edge={source:'a',target:'b',type:'DEPENDS_ON',provenance_type:'HUMAN_VERIFIED',evidence_ids:['proof'],witness_span:{evidence_id:'proof',start:0,end:14,offset_basis:'source_chunk',offset_unit:'unicode_codepoint'}};
 const source={project_id:'p',evidence:[proof],relationships:[edge]};
 const packet=JSON.parse(compactMcpContext(MCP_CONTEXT_PREFIX+JSON.stringify(source)).slice(MCP_CONTEXT_PREFIX.length));
 assert.equal(packet.relationships.length,1);assert.equal(packet.omitted_relationship_count,0);
 assert.deepEqual(retainMcpRelationships([edge],[]),[]);
 assert.deepEqual(retainMcpRelationships([edge],[{...proof,content:'Altered proof'}]),[]);
 assert.deepEqual(retainMcpRelationships([edge],[{...proof,excerpt_truncated:true}]),[]);
 assert.deepEqual(retainMcpRelationships([{...edge,provenance_type:'LLM_CANDIDATE'}],[proof]),[]);
});

test('provider 413 receives exactly one smaller retry; a second rejection is returned to the caller', async t => {
  const received = [];
  let status = 413;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'request body too large' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/chat/completions`;
  let reductions = 0;
  const response = await fetchLlmWithRetry(url, { method: 'POST', body: fullBody() }, {
    contextFallbackContent: 'Story title: secure login. Return strict JSON.', onContextFallback: () => reductions++
  });
  assert.equal(response.status, 413);
  assert.equal(received.length, 2);
  assert.equal(reductions, 1);
  assert.equal(received[1].messages[1].content, 'Story title: secure login. Return strict JSON.');
  status = 401;
  const auth = await fetchLlmWithRetry(url, { method: 'POST', body: fullBody() });
  assert.equal(auth.status, 401);
  assert.equal(received.length, 3);
  status = 400;
  const malformed = await fetchLlmWithRetry(url, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'short' }] }) });
  assert.equal(malformed.status, 400);
  assert.equal(received.length, 4, 'a non-smaller request must not repeat');
});


test('Story case generation retains acceptance criteria, user guidance and exact Story mapping in fallback', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const exported = {};
  const integration = { id: 'llm', type: 'llm', is_active: true, base_url: 'http://provider.test', model: 'model', api_key: 'test-key' };
  let observed;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../manual/backend/services/requirementDesign.service.js'), 'utf8'), {
    exports: exported,
    require: id => {
      if (id === '@hellotest/testing/backend/services/testCase.service') return {};
      if (id === '@hellotest/platform/backend/services/dropdownCatalog.service') return {getField:async()=>({default_value:'functional',options:[{value:'functional',active:true}]})};
      if (id === '@hellotest/knowledge/backend/services/aiKnowledge.service') return { buildKnowledgeContextPackage: async () => ({ knowledge: [{ title: 'Private Context', content: 'KNOWLEDGE DETAIL' }] }) };
      if (id === '@hellotest/integration/backend/services/aiLlmSelection.service') return { resolveLlmIntegrationForUsage: async () => integration };
      if (id === '@hellotest/platform/backend/src/utils/llmHttpClient') return { fetchLlmWithRetry: async (_url, init, options) => {
        if(options.featureKey==='ai.authoring.request_validation')return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({decision:'accept',explanation:'Request matches Test Case authoring.',suggestions:[]})}}]}),{headers:{'content-type':'application/json'}});
        observed = { body: JSON.parse(init.body), fallback: expandManagedInstructions(options.contextFallbackContent) };
        options.onContextFallback();
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ testCases: [{ title: 'Valid sign in', description: 'Sign in using an authorized account and reach the account home.', priority: 3, test_case_type: 'functional', parameter_values: {}, requirement_refs: ['R1'], steps: [{ action: 'Submit supplied credentials', expected_result: 'Dashboard opens' }] }] }) } }] }), { headers: { 'content-type': 'application/json' } });
      } };
      return require(sourceFile(id, "services"));
    }
  });
  const result = await exported.previewRequirementsTestCases({ requirements: [{ id: 'story-internal-id', title: 'Secure sign in', description: 'LONG DESCRIPTION', additional_fields: { acceptance_criteria: ['User sees the account home'] }, project_id: 'project' }], appType: { id: 'app', name: 'Web', type: 'web' }, max_cases: 3, additional_context: 'EXTRA CONTEXT', images: [{ name: 'wireframe', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' }], authoring_mode: 'structured' });
  assert.match(JSON.stringify(observed.body), /LONG DESCRIPTION/);
  assert.match(JSON.stringify(observed.body), /User sees the account home/);
  assert.match(observed.fallback, /Secure sign in/);
  assert.equal(JSON.parse(observed.fallback).application_contract.max_cases,3);
  assert.match(observed.fallback, /requirement_refs/);
  assert.match(observed.fallback, /LONG DESCRIPTION/);
  assert.match(observed.fallback, /User sees the account home/);
  assert.match(observed.fallback, /EXTRA CONTEXT/);
  assert.doesNotMatch(observed.fallback, /KNOWLEDGE DETAIL|data:image/);
  assert.equal(result.cases[0].requirement_ids[0], 'story-internal-id');
  assert.equal(result.context_reduced, true);
  const legacy = await exported.previewRequirementsTestCases({ requirements: [{ id: 'legacy-story', title: 'Legacy Story without explicit criteria' }], appType: { id: 'app', name: 'Web', type: 'web' }, max_cases: 1 });
  assert.equal(legacy.cases[0].requirement_ids[0], 'legacy-story');
});
