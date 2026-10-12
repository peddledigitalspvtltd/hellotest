const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const profiles = require('../../shared/workflowSpecialists.json');
const policies = require('@hellotest/platform/shared/agentContextPolicies.json');
const scopes = require('../../../ai/backend/services/agentEvidenceScope');
const { spoolArchive } = require('../../backend/agents/archiveTransfer');
const { normalizeArtifacts } = require('../../backend/services/agentArtifacts');
const { proposalOperation } = require('../../backend/services/agentProposal.service');
const { contextSelection, normalizeLaunch } = require('../../backend/services/qualityAgentContracts');

test('every Studio specialist has the same intent and source policy in MCP routing', () => {
  assert.equal(Object.keys(policies).length,31);
  for (const kind of ['object_repository','api_tests','repository_knowledge','component_tests','browser-web','browser-security','browser-performance','browser-accessibility','browser-visual']) assert.ok(policies[kind]?.scopes.length,kind);
  for (const [id, profile] of Object.entries(profiles)) {
    assert.deepEqual(policies[id].scopes, profile.scopes, id);
    assert.equal(policies[id].outputInstructions, profile.outputInstructions, id);
  }
});
test('scope identifiers are SQL parameters and exact case/story/run/build filters remain conjunctive', () => {
  const scope = { story_id: "story' OR TRUE --", build: 'build-17', execution_id: 'run-3', environment_id: 'env-2' };
  const story = scopes.predicate('story','requirements',scope), run = scopes.predicate('run','executions',scope);
  assert.ok(!story.sql.includes(scope.story_id)); assert.deepEqual(story.params,[scope.story_id]);
  assert.match(run.sql,/executions.id = \?.*executions.build = \?.*executions.test_environment_id = \?/);
  assert.deepEqual(run.params,['run-3','build-17','env-2',scope.story_id]);
});
test('disk-backed transfer handles archives beyond the old 20 MB limit, hashes chunks and cleans its temporary source', async () => {
  const chunk = Buffer.alloc(1024*1024); chunk.writeUInt32LE(0x04034b50);
  const digest = createHash('sha256');
  async function* chunks() { for(let i=0;i<24;i++) { digest.update(chunk); yield chunk; } }
  const file = await spoolArchive(Readable.from(chunks()));
  assert.equal(file.size,24*1024*1024); assert.equal(file.digest,digest.digest('hex')); assert.equal((await fs.stat(file.archivePath)).size,file.size);
  await file.dispose(); await assert.rejects(fs.stat(file.archivePath), {code:'ENOENT'});
});
test('invalid and cancelled disk transfers fail without returning usable source authority', async () => {
  await assert.rejects(spoolArchive(Readable.from([Buffer.from('invalid')])),/valid ZIP/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(spoolArchive(Readable.from([Buffer.from('PK')]),{signal:controller.signal}), {name:'AbortError'});
});
test('browser context survives launch normalization without permitting unknown scopes or executable metadata', () => {
  const input={project_id:'project',kind:'web',target_url:'https://app.test',goal:'Review checkout',options:{mission:{max_actions:4,allow_form_submission:false}},llm_integration_id:'selected-model',context_scopes:['stories','system','test-cases'],evidence_scope:{story_id:'story-1',script:'forbidden'},smart_context:{source_ids:['source-1'],reviewed_context:'Checkout intent'}};
  const request=normalizeLaunch(input); assert.equal(request.llm_integration_id,'selected-model');assert.deepEqual(request.context_scopes,['stories','test-cases']);assert.deepEqual(request.evidence_scope,{story_id:'story-1'});assert.deepEqual(request.smart_context.source_ids,['source-1']);
  assert.deepEqual(contextSelection({context_scopes:[]}).context_scopes,[]);
});
test('test proposals preserve data, cleanup and evidenced Story links through native acceptance', () => {
  const citation={id:'source-1'}, artifact={kind:'test_case',title:'Retry safely',description:'One order remains',priority:'P2',citation_ids:['source-1'],requirement_ids:['story-1'],prerequisites:['Existing order'],test_data:['retry key: fixed-1'],cleanup:['Remove fixture order'],steps:[{action:'Retry with fixed-1',expected_result:'One order exists'}]};
  const [normalized]=normalizeArtifacts([artifact],[citation],[{id:'story-1',citation_id:'source-1'}]);
  const operation=proposalOperation(normalized,normalized,{citations:[citation],transaction:{project_id:'project'}},'app','actor');
  assert.deepEqual(operation.payload.requirement_ids,['story-1']);assert.match(operation.payload.description,/retry key: fixed-1/);assert.match(operation.payload.description,/Cleanup/);
  assert.throws(()=>normalizeArtifacts([{...artifact,requirement_ids:['unknown']}],[citation],[]));
});
test('a Run proposal selects evidenced cases and native acceptance creates a manual draft without starting execution', () => {
  const citation={id:'cases-1'}, artifact={kind:'run',title:'Checkout regression',description:'Prioritize checkout retry boundaries',citation_ids:['cases-1'],test_case_ids:['case-1'],exit_criteria:['All selected cases pass; failures require review']};
  const [normalized]=normalizeArtifacts([artifact],[citation],[{kind:'test_case',id:'case-1',citation_id:'cases-1'}]);
  const operation=proposalOperation(normalized,normalized,{citations:[citation],transaction:{project_id:'project'}},'app','actor');
  assert.equal(operation.url,'/executions');assert.equal(operation.permission,'run.create');assert.equal(operation.payload.execution_mode,'manual');assert.equal(operation.payload.created_by,'actor');assert.deepEqual(operation.payload.test_case_ids,['case-1']);
  assert.throws(()=>normalizeArtifacts([{...artifact,test_case_ids:['invented']}],[citation],[]));
});

test('repository review batches cover every finding and preserve source identity within each prompt budget', () => {
  const {reviewBatches} = require('../../backend/agents/reviewBatches');
  const input=Array.from({length:100},(_,index)=>({id:`finding-${index}`,title:`Case ${index}`,description:'Observed contract '.repeat(100),evidence:[{path:'routes.ts',line:index+1}],steps:[{action:'Call route',expected_result:'Documented response'}]}));
  const batches=reviewBatches(input);assert.ok(batches.length>1);
  assert.deepEqual(batches.flat().map(item=>item.id),input.map(item=>item.id));
  for(const batch of batches)assert.ok(Buffer.byteLength(JSON.stringify(batch))<=12000);
  assert.deepEqual(batches.flat().map(item=>item.evidence),input.map(item=>item.evidence));
});

test('unlinked Test Case drafts can be normalized again during reviewed native acceptance',()=>{
 const citation={id:'source-1'},draft={kind:'test_case',title:'Inspect a draft',description:'Verify the recorded draft',citation_ids:['source-1'],steps:[{action:'Open the draft',expected_result:'The title and steps appear'}]};
 const [normalized]=normalizeArtifacts([draft],[citation]);assert.deepEqual(normalized.requirement_ids,[]);
 assert.equal(proposalOperation(normalized,normalized,{citations:[citation],transaction:{project_id:'project'}},'app','actor').url,'/test-cases');
});

test('Gherkin and platform-specific Test Case proposals survive native acceptance without being rewritten as web steps',()=>{
 const citation={id:'source-1'},base={kind:'test_case',title:'Checkout retry',description:'Verify one order after retry',citation_ids:['source-1']};
 const [gherkin]=normalizeArtifacts([{...base,authoring_mode:'gherkin',gherkin_document:'Feature: Checkout\nScenario: Retry\n Given an order\n When checkout is retried\n Then one order remains',steps:[]}],[citation]);
 const operation=proposalOperation(gherkin,gherkin,{citations:[citation],transaction:{project_id:'project'}},'app','actor');
 assert.equal(operation.payload.authoring_mode,'gherkin');assert.deepEqual(operation.payload.steps,[]);assert.match(operation.payload.gherkin_document,/Then one order remains/);
 const [mobile]=normalizeArtifacts([{...base,steps:[{step_type:'android',action:'Open checkout',expected_result:'Checkout appears'}]}],[citation]);
 assert.equal(proposalOperation(mobile,mobile,{citations:[citation],transaction:{project_id:'project'}},'app','actor').payload.steps[0].step_type,'android');
 assert.throws(()=>normalizeArtifacts([{...base,authoring_mode:'gherkin',gherkin_document:'Feature: Checkout\nScenario: Incomplete\n Given an order'}],[citation]));
});
