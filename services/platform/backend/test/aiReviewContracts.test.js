const { sourceFile } = require("./helpers/sourceFile");
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { groomingCandidate } = require('./helpers/groomingCandidate');

process.env.NODE_ENV = 'test';
function load(name, overrides) {
  const filename = sourceFile(`${name}.js`, "services");
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    id => {
      const key = Object.keys(overrides).find(candidate => candidate.split('/').pop() === id.split('/').pop());
      return key === undefined ? localRequire(id) : overrides[key];
    }, module, module.exports);
  return module.exports;
}
const integration = { id: 'provider', name: 'Review model', type: 'llm', is_active: true, model: 'model', base_url: 'https://provider.invalid/v1' };
function fixture(content, finishReason = 'stop') {
  const calls = [];
  return {
    calls,
    overrides: {
      './aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => integration },
      '../utils/llmHttpClient': { fetchLlmWithRetry: async (url, init, policy) => {
        calls.push({ url, body: JSON.parse(init.body), policy });
        if (content instanceof Error) throw content;
        return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }));
      } }
    }
  };
}
const story = { id: 'story', project_id: 'project', title: 'Invoice approval', description: 'An approver verifies an invoice.', acceptance_criteria: ['Approval records the approver.'] };
const caseDraft = { id: 'case', title: 'Approve invoice', description: 'Review the invoice approval contract.',
  steps: [{ id: 'authored-step', action: 'Submit approval', expected_result: 'The recorded approver is returned.' }] };
const caseReview = readiness => ({ summary: 'Review invoice approval.', dimensions: [{ id: 'scenario-coverage', explanation: 'The approval scenario traces to its Story.', evidence: ['draft:test-case:case', 'requirement:story'] }],
  ...(readiness === undefined ? {} : { automation_readiness: readiness }) });
const ready = { status: 'ready', summary: 'The supplied Story establishes the required behavior and inputs.', evidence_refs: ['requirement:story'], missing_context: [] };

test('native Test Case assurance requests typed suitability independently of review verification', async () => {
  const readiness = { status: 'needs_input', summary: 'The draft proposes an API request without a supplied API contract.', evidence_refs: ['requirement:story'],
    missing_context: [{ kind: 'api_contract', reason: 'Supply the request endpoint and supported response contract.', evidence_refs: ['draft:test-case:case', 'requirement:story'], step_refs: ['step:1'] }] };
  const provider = fixture(JSON.stringify(caseReview(readiness)));
  const result = await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project', assessAutomationReadiness: true });
  assert.equal(result.verification.status, 'passed', 'Cited review validity does not mean suitability passed');
  assert.deepEqual(result.assurance_review.automation_readiness, readiness);
  assert.equal(provider.calls.length, 1);
  const prompt = provider.calls[0].body.messages[1].content;
  assert.match(prompt, /HELLOTEST_AI:ai\.quality\.test_case_assurance:artifactAssurance\.automationReadiness/);
  const contract = JSON.parse(prompt.split('\n').at(-1));
  assert.deepEqual(contract.product_evidence_refs, ['requirement:story']);
  assert.deepEqual(contract.step_references, [{ ref: 'step:1', step_order: 1, step_id: 'authored-step' }]);
  assert.deepEqual(contract.automation_readiness_contract.properties.status.enum, ['ready', 'needs_input', 'unknown', 'not_applicable']);
  const transportSchema=provider.calls[0].policy.outputSchema;
  assert.ok(transportSchema.properties.dimensions);
  assert.equal(transportSchema.required.includes('automation_readiness'),false,'Suitability failure must not discard the supported core review.');
  assert.deepEqual(transportSchema.properties.automation_readiness,{},'Readiness has its own deterministic unknown fallback.');
  const expanded = require('./helpers/managedInstructions').expandManagedInstructions(prompt);
  assert.match(expanded, /do not infer method, endpoint, authentication/);
  assert.match(expanded, /product_evidence_refs/);
});

test('typed ready requires an independent supplied product reference', async () => {
  const provider = fixture(JSON.stringify(caseReview(ready)));
  const result = await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project', assessAutomationReadiness: true });
  assert.deepEqual(result.assurance_review.automation_readiness, ready);
  assert.deepEqual(result.verification.checks, ['output_shape', 'evidence_references']);
});

test('literal linked API specification reaches readiness intact without requiring optional fixtures or execution evidence', async () => {
  const contractStory={...story,description:'GET http://api:3000/health/ready requires no authentication, request body, fixture data, browser or parameters. The ready-state response is HTTP 200 JSON with ok=true, probe="readiness", status="ready" and service="hellotest-api".',
    acceptance_criteria:['GET http://api:3000/health/ready returns HTTP 200.','JSON has ok=true, probe="readiness", status="ready" and service="hellotest-api".','Authentication, request body and test-data inputs are explicitly absent.']};
  const contractCase={...caseDraft,steps:[{step_type:'api',action:'GET http://api:3000/health/ready',expected_result:'HTTP 200; JSON ok=true, probe="readiness", status="ready", service="hellotest-api".'}]};
  const provider=fixture(JSON.stringify(caseReview(ready)));
  const result=await load('artifactAssurance.service',provider.overrides).reviewArtifact({artifactType:'test-case',savedArtifact:contractCase,linkedEvidence:[{...contractStory,kind:'requirement'}],projectId:'project',assessAutomationReadiness:true});
  assert.equal(result.assurance_review.automation_readiness.status,'ready');
  const prompt=provider.calls[0].body.messages[1].content;
  for(const literal of ['GET http://api:3000/health/ready','no authentication, request body, fixture data, browser or parameters','service=\\"hellotest-api\\"'])assert.ok(prompt.includes(literal),literal);
  assert.doesNotMatch(prompt,/context_limits/,'These source fields fit their limits without clipping');
  const expanded=require('./helpers/managedInstructions').expandManagedInstructions(prompt);
  assert.match(expanded,/A linked Story description, acceptance criteria or executable specification may supply the API contract directly/);
  assert.match(expanded,/Explicitly absent inputs are resolved requirements/);
  assert.match(expanded,/do not manufacture findings to justify a heuristic/);
});

for(const [artifactType,reviewPurpose,featureKey] of [
  ['story','assurance','ai.quality.story_assurance'],['test-case','assurance','ai.quality.test_case_assurance'],
  ['story','change-impact','ai.requirement.change_impact'],['test-case','change-impact','ai.test_case.change_impact']
]) test(`${featureKey} uses its own managed main and repair instructions`,async()=>{
  const ref=`draft:${artifactType}:${artifactType==='story'?'story':'case'}`;
  const dimensionId=artifactType==='story'?'design-maturity':'scenario-coverage';
  let requests=0;
  const provider=fixture('unused');
  provider.overrides['../utils/llmHttpClient'].fetchLlmWithRetry=async(url,init,policy)=>{
    const body=JSON.parse(init.body);provider.calls.push({url,body,policy});requests++;
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(requests===1?{summary:'Missing citations',dimensions:[{id:dimensionId,explanation:'Review the contract.'}]}:{summary:'Review the supplied contract.',dimensions:[{id:dimensionId,explanation:'Review the contract.',evidence:[ref]}]})}}]}));
  };
  const result=await load('artifactAssurance.service',provider.overrides).reviewArtifact({artifactType,reviewPurpose,savedArtifact:artifactType==='story'?story:caseDraft,projectId:'project'});
  assert.equal(result.response_repaired,true);assert.equal(provider.calls.length,2);
  for(const call of provider.calls){
    assert.equal(call.policy.featureKey,featureKey);
    const markers=JSON.stringify(call.body).match(/HELLOTEST_AI:[^:]+:[^⟧]+/g)||[];
    assert.ok(markers.length>3);
    assert.ok(markers.every(marker=>marker.startsWith(`HELLOTEST_AI:${featureKey}:`)),JSON.stringify(markers));
    const expanded=require('./helpers/managedInstructions').expandManagedInstructions(JSON.stringify(call.body));
    assert.doesNotMatch(expanded,/HELLOTEST_AI:/,'Every selected profile supplies its managed contract defaults');
  }
});

for (const [name, readiness, additionalContext] of [
  ['absent assessment', undefined],
  ['draft-only authority', { ...ready, evidence_refs: ['draft:test-case:case'] }],
  ['reviewed model context as sole authority', { ...ready, evidence_refs: ['review:context'] }, 'Upstream AI review says the API returns status 200.'],
  ['forged product reference', { ...ready, evidence_refs: ['requirement:foreign-story'] }],
  ['free-text status', { ...ready, status: 'approved' }],
  ['ready with unresolved dependencies', { ...ready, missing_context: [{ kind: 'fixture', reason: 'No fixture contract supplied.', evidence_refs: ['requirement:story'], step_refs: ['step:1'] }] }],
  ['needs input without a cited gap', { ...ready, status: 'needs_input' }],
  ['invented step reference', { ...ready, status: 'needs_input', missing_context: [{ kind: 'api_contract', reason: 'The endpoint is missing.', evidence_refs: ['requirement:story'], step_refs: ['invented-step'] }] }],
  ['oversized assessment', { ...ready, summary: 'x'.repeat(801) }],
  ['unexpected fields', { ...ready, approved: true }]
]) {
  test(`native suitability stays unknown for ${name}`, async () => {
    const provider = fixture(JSON.stringify(caseReview(readiness)));
    const result = await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
      linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project', assessAutomationReadiness: true, additionalContext });
    assert.equal(result.assurance_review.automation_readiness.status, 'unknown');
    assert.equal(result.verification.status, 'passed', 'A usable manual review survives an unavailable suitability assessment');
    assert.equal(provider.calls.length, 1, 'Missing suitability does not trigger additional model work');
  });
}

test('existing assurance consumers do not gain suitability semantics without opting in', async () => {
  const provider = fixture(JSON.stringify(caseReview(ready)));
  const result = await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project' });
  assert.equal(Object.hasOwn(result.assurance_review, 'automation_readiness'), false);
  assert.doesNotMatch(provider.calls[0].body.messages[1].content, /automation_readiness_contract/);
});

for (const artifactType of ['story', 'test-case']) {
  test(`${artifactType} assurance reads content blocks and keeps a valid cited dimension`, async () => {
    const id = artifactType === 'story' ? 'industry-standards' : 'scenario-coverage';
    const content = JSON.stringify({ summary: 'Verify the approval outcome.', dimensions: [
      { id, explanation: 'Verify the recorded approver.', evidence: [`draft:${artifactType}:story`] }
    ] });
    const provider = fixture([{ type: 'text', text: content.slice(0, 60) }, { type: 'text', text: content.slice(60) }]);
    const service = load('artifactAssurance.service', provider.overrides);
    const result = await service.reviewArtifact({ artifactType, savedArtifact: story, projectId: 'project', user: { id: 'user' } });
    assert.equal(result.fallback_used, false);
    assert.equal(result.assurance_review.dimensions[0].explanation, 'Verify the recorded approver.');
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].policy.contextFallback, false, 'Serialized evidence must never be cut by generic transport trimming');
  });
}

test('assurance accepts common provider aliases for nested reviews and citations', async () => {
  const provider = fixture(JSON.stringify({ review: {
    executive_summary: 'Review the approval evidence.',
    dimensions: { 'industry-standards': { finding: 'The draft records an approver.', citation_ids: [{ citation_id: 'DRAFT:STORY:STORY' }], action: 'Keep the approver criterion.' } },
    findings: [{ label: 'Confirm rejection handling', detail: 'The draft does not describe rejection.', evidence_refs: ['draft:story:story'], action: 'Confirm whether rejection is in scope and record its observable outcome.' }]
  } }));
  const service = load('artifactAssurance.service', provider.overrides);
  const result = await service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', user: { id: 'user' } });
  assert.equal(result.fallback_used, false);
  assert.equal(result.assurance_review.dimensions[0].evidence[0], 'draft:story:story');
  assert.equal(result.assurance_review.insights[0].title, 'Confirm rejection handling');
  assert.equal(result.assurance_review.insights[0].priority, 'medium', 'Only an absent legacy priority receives the compatibility default');
  assert.equal(provider.calls.length, 1);
});

for (const [name, patch] of [
  ['invalid supplied legacy priority', { priority: 'critical-approved' }],
  ['missing legacy recommendation', { recommendation: undefined }],
  ['missing legacy finding title', { title: undefined }],
  ['missing legacy explanation', { explanation: undefined }],
  ['missing legacy citation', { evidence: [] }]
]) test(`meaningful assurance findings require repair for ${name}`, async () => {
  const provider = fixture(JSON.stringify({ ...caseReview(), insights: [{ id: 'legacy-gap', title: 'Clarify the result', explanation: 'The approval result is ambiguous.', evidence: ['draft:test-case:case'], recommendation: 'State the observable stored approver value.', ...patch }] }));
  await assert.rejects(load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project' }), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
  assert.equal(provider.calls.length, 2, 'A meaningful finding cannot silently disappear or receive an invented severity');
});

test('assurance repairs a usable review whose first response omitted citation fields', async () => {
  const calls = [];
  const overrides = {
    './aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => integration },
    '../utils/llmHttpClient': { fetchLlmWithRetry: async (url, init, policy) => {
      calls.push({ url, body: JSON.parse(init.body), policy });
      const content = calls.length === 1
        ? { summary: 'Review approval.', dimensions: [{ id: 'industry-standards', explanation: 'Record the approver.' }] }
        : { summary: 'Review approval.', dimensions: [{ id: 'industry-standards', explanation: 'Record the approver.', evidence: ['draft:story:story'] }] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    } }
  };
  const service = load('artifactAssurance.service', overrides);
  const result = await service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', user: { id: 'user' } });
  assert.equal(result.fallback_used, false);
  assert.equal(result.response_repaired, true);
  assert.deepEqual(result.assurance_review.dimensions[0].evidence, ['draft:story:story']);
  assert.equal(calls.length, 2);
  assert.match(require('./helpers/managedInstructions').expandManagedInstructions(calls[1].body.messages[1].content), /Allowed evidence refs/);
  assert.ok(calls[1].policy.timeoutMs > 0 && calls[1].policy.timeoutMs <= calls[0].policy.timeoutMs);
  assert.ok(calls.every(call => call.policy.maxAttempts === 1 && call.policy.compatibility === false));
});

test('a slow initial response leaves a full bounded repair deadline and the same output allowance',async t=>{
  let now=1700000000000; t.mock.method(Date,'now',()=>now);
  const provider=fixture('unused');
  provider.overrides['../utils/llmHttpClient'].fetchLlmWithRetry=async(url,init,policy)=>{
    provider.calls.push({body:JSON.parse(init.body),policy});
    if(provider.calls.length===1){now+=59000;throw Object.assign(new Error('Output contract mismatch'),{code:'AI_OUTPUT_SCHEMA_VIOLATION',generation_received:true,nonRetryable:true,retryable:false,
      validation_errors:[{path:'/insights/0/kind',keyword:'enum',message:'must be equal to one of the allowed values'}]});}
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'Review the selected Story.',dimensions:[{id:'industry-standards',explanation:'Its approval behavior is recorded.',evidence:['draft:story:story']}]})}}]}));
  };
  const result=await load('artifactAssurance.service',provider.overrides).reviewArtifact({artifactType:'story',savedArtifact:story,projectId:'project'});
  assert.equal(result.response_repaired,true);assert.equal(provider.calls.length,2);
  assert.equal(provider.calls[1].policy.timeoutMs,60000);
  assert.equal(provider.calls[1].policy.maxOutputTokens,provider.calls[0].policy.maxOutputTokens);
  assert.equal(result.model_execution.deadline_ms,120000);
});

function groomingOverrides(provider) {
  return { ...provider.overrides,
    '../db': { prepare() { assert.fail('Optional records must not be fetched without access'); } },
    './optionalEvidenceAccess.service': { getOptionalEvidenceAccess: async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, false])) }
  };
}
test('Grooming accepts content blocks without losing grounded model output', async () => {
  const provider = fixture([{ type: 'text', text: JSON.stringify(groomingCandidate({ layman: { explanation: 'An approver verifies the invoice before approval.', analogy: '', evidence_refs: ['requirement:story'] } })) }]);
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  const result = await service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' } });
  assert.equal(result.grooming.layman.explanation, 'An approver verifies the invoice before approval.');
  assert.equal(provider.calls[0].policy.contextFallback, false);
  assert.equal(provider.calls.length, 1);
});

test('Grooming rejects a failed model without leaking provider internals', async () => {
  const provider = fixture(Object.assign(new Error('PRIVATE_PROVIDER_DETAIL'), { statusCode: 504 }));
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  await assert.rejects(service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' } }), error => {
    assert.equal(error.code, 'AI_ASSESSMENT_FAILED');
    assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_DETAIL/);
    return true;
  });
  assert.equal(provider.calls.length, 1);
});

test('Smart Run reserves sufficient response space and reads structured content blocks', async () => {
  const cases = Array.from({ length: 30 }, (_, index) => ({ test_case_id: `case-${index}`, reason: 'Review the changed approval behavior against its linked story evidence.', evidence_refs: [`test-case:case-${index}`] }));
  const provider = fixture([{ type: 'text', text: JSON.stringify({ cases }) }]);
  const service = load('executionPlanning.service', provider.overrides);
  const internals = service.__smartExecutionInternals;
  const response = await internals.requestChatCompletion({ integration, content: 'Review these existing cases.' });
  assert.equal(JSON.parse(response).cases.length, 30);
  assert.equal(provider.calls[0].body.max_tokens, 8192);
  assert.equal(provider.calls[0].policy.maxOutputTokens, 8192);
  assert.equal(provider.calls[0].policy.contextFallback, false);
  assert.throws(() => internals.readPlanningResponseContent({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), /truncated/);
  assert.throws(() => internals.normalizeModelExplanations({}, new Map()), /cases array/);
  const allowed = new Map([['case-1', { evidence_refs: ['test-case:case-1'] }]]);
  const normalized = internals.normalizeModelExplanations({ cases: [
    { test_case_id: 'case-1', reason: 'x'.repeat(361), evidence_refs: ['test-case:case-1'] },
    { test_case_id: 'case-1', reason: 'Grounded explanation.', evidence_refs: ['test-case:case-1'] },
    { test_case_id: 'case-1', reason: 'Duplicate explanation.', evidence_refs: ['test-case:case-1'] },
    { test_case_id: 'case-2', reason: 'Not supplied to model.', evidence_refs: ['test-case:case-2'] }
  ] }, allowed);
  assert.equal(normalized.size, 1);
  assert.equal(normalized.get('case-1').reason, 'Grounded explanation.');
});

test('Grooming reviews unsaved draft content while preserving persisted scope and identity', async () => {
  const provider = fixture(JSON.stringify(groomingCandidate({ layman: { explanation: 'Review the current draft.', analogy: '', evidence_refs: ['requirement:story'] } })));
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  const result = await service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' }, proposedChange: {
    id: 'other-story', project_id: 'other-project', title: 'Current draft', description: 'UNSAVED_DRAFT_SENTINEL', acceptance_criteria: ['UNSAVED_ACCEPTANCE_SENTINEL'], specification_content: 'UNSAVED_SPEC_SENTINEL'
  } });
  assert.equal(result.requirement.id, 'story');
  assert.equal(result.requirement.title, 'Current draft');
  assert.equal(result.context.scope.project_id, 'project');
  const prompt = provider.calls[0].body.messages[1].content;
  assert.match(prompt, /UNSAVED_DRAFT_SENTINEL/);
  assert.match(prompt, /UNSAVED_ACCEPTANCE_SENTINEL/);
  assert.match(prompt, /UNSAVED_SPEC_SENTINEL/);
  assert.doesNotMatch(prompt, /An approver verifies an invoice|other-story|other-project/);
});

test('An empty Grooming object fails instead of claiming model refinement', async () => {
  const provider = fixture('{}');
  const service = load('requirementWorkspace.service', groomingOverrides(provider));
  await assert.rejects(service.previewGrooming({ requirement: story, project: { id: 'project' }, user: { id: 'user' } }), { code: 'AI_GROOMING_OUTPUT_INVALID' });
  assert.equal(provider.calls.length, 2);
});

test('assurance rejects forged references after exactly one repair', async () => {
  const provider = fixture(JSON.stringify({ dimensions: [{ id: 'industry-standards', explanation: 'Invented finding', evidence: ['invented:source'] }] }));
  const service = load('artifactAssurance.service', provider.overrides);
  await assert.rejects(service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', user: { id: 'user' } }), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
  assert.equal(provider.calls.length, 2);
  assert.ok(provider.calls.every(call => call.policy.maxAttempts === 1 && call.policy.contextFallback === false && call.policy.compatibility === false));
});

test('assurance requires a configured model before making a request', async () => {
  const provider = fixture('{}');
  provider.overrides['./aiLlmSelection.service'].resolveLlmIntegrationForUsage = async () => null;
  const service = load('artifactAssurance.service', provider.overrides);
  await assert.rejects(service.reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project' }), { code: 'AI_MODEL_REQUIRED' });
  assert.equal(provider.calls.length, 0);
});

test('Test Case assurance retains the linked Story title, long description, acceptance and specification together', async () => {
  const linkedStory = { ...story, title: 'FULL_STORY_TITLE', description: `${'Product detail. '.repeat(110)}LATE_PRODUCT_RULE`,
    acceptance_criteria: ['A1', 'A2', 'A3', 'A4', 'FIFTH_ACCEPTANCE_RULE'], specification_content: 'EXECUTABLE_SPEC_CONTEXT' };
  const provider = fixture(JSON.stringify(caseReview()));
  await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: { ...caseDraft, parameter_values: { invoice_number: 'SYNTHETIC-INV-001' } },
    linkedEvidence: [{ ...linkedStory, kind: 'requirement' }], projectId: 'project' });
  const prompt = provider.calls[0].body.messages[1].content;
  for (const value of ['FULL_STORY_TITLE', 'LATE_PRODUCT_RULE', 'FIFTH_ACCEPTANCE_RULE', 'EXECUTABLE_SPEC_CONTEXT', 'SYNTHETIC-INV-001']) assert.ok(prompt.includes(value), value);
  const expanded = require('./helpers/managedInstructions').expandManagedInstructions(prompt);
  assert.match(expanded, /corresponding observable expected result|corresponding observable expected|observable per-step outcomes/);
  assert.match(expanded, /synthetic/);
  assert.match(expanded, /focused positive case/);
});

test('typed assurance findings retain exact field and step locations and actionable recommendations', async () => {
  const finding = { id: 'assertion-gap', priority: 'high', kind: 'artifact_quality', title: 'Make the approval result observable',
    explanation: 'The expected result does not state which recorded field proves approval.', evidence: ['draft:test-case:case', 'requirement:story'],
    affected_fields: ['steps'], step_refs: ['step:1'], recommendation: 'Assert the recorded approver equals the submitted approver; completion is an explicit action/result pair.' };
  const provider = fixture(JSON.stringify({ ...caseReview(), insights: [finding] }));
  const result = await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project' });
  assert.deepEqual(result.assurance_review.insights, [finding]);
  const contract = JSON.parse(provider.calls[0].body.messages[1].content.split('\n').at(-1));
  assert.deepEqual(contract.step_references, [{ ref: 'step:1', step_order: 1, step_id: 'authored-step' }]);
  assert.ok(contract.review_contract.insights[0].affected_fields.includes('parameter_values'));
  assert.deepEqual(contract.evidence_boundary, { linked_records_available: 1, linked_records_included: 1, omitted_linked_records: 0, content_scope: 'bounded_supplied_only' });
});

for (const [name, patch] of [
  ['a nonexistent step', { step_refs: ['step:99'] }],
  ['a fabricated field', { affected_fields: ['imaginary_approval'] }],
  ['an unsupported priority', { priority: 'blocker-approved' }],
  ['no concrete recommendation', { recommendation: '' }],
  ['an unsupported category', { kind: 'passed' }]
]) test(`assurance rejects ${name} after one bounded repair`, async () => {
  const provider = fixture(JSON.stringify({ ...caseReview(), insights: [{ id: 'finding', priority: 'medium', kind: 'artifact_quality', title: 'Review expected result',
    explanation: 'The result is ambiguous.', evidence: ['draft:test-case:case'], affected_fields: ['steps'], step_refs: ['step:1'], recommendation: 'State the observable approval outcome.', ...patch }] }));
  await assert.rejects(load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project' }), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
  assert.equal(provider.calls.length, 2);
});

test('Story impact sends bounded authorized Test Case bodies and downstream relationship metadata to the reviewer', async () => {
  const queries = [], reviews = [];
  const linkedCases = Array.from({ length: 10 }, (_, i) => ({ id: `case-${i}`, title: `Scenario ${i}`, description: `CASE_DESCRIPTION_${i}` }));
  const service = load('qualityAssistance.service', {
    '../db': { prepare(sql) { return {
      get: async () => story,
      all: async (...args) => {
        queries.push({ sql, args });
        if (/SELECT test_cases\.\*/.test(sql)) return linkedCases;
        if (/SELECT test_steps\.\*/.test(sql)) return linkedCases.slice(0, 6).map(item => ({ test_case_id: item.id, step_order: 1, action: `SUBMIT_${item.id}`, expected_result: 'Approval is recorded.' }));
        if (/SELECT DISTINCT test_suites/.test(sql)) return [{ id: 'suite', name: 'Invoice suite' }];
        if (/SELECT DISTINCT executions/.test(sql)) return [{ id: 'run', status: 'running' }];
        if (/SELECT DISTINCT automation_learning_cache/.test(sql)) return [{ id: 'locator', test_case_id: 'case-0', locator_intent: 'Approve button', confidence: 0.8 }];
        assert.fail(sql);
      }
    }; } },
    './entityScope.service': { requireEntityPermission: async () => ({ projectId: 'project' }) },
    './optionalEvidenceAccess.service': { getOptionalEvidenceAccess: async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, true])) },
    './artifactAssurance.service': { reviewArtifact: async args => { reviews.push(args); return {}; } }
  });
  const result = await service.previewRequirementImpact({ requirementId: 'story', user: { id: 'reviewer' }, proposedChange: { acceptance_criteria: ['Changed approval condition'] } });
  const review = reviews[0];
  assert.equal(result.impact.totals.test_cases, 10, 'The UI retains all linked records');
  assert.equal(review.linkedEvidence.filter(item => item.kind === 'test-case').length, 8);
  assert.deepEqual(review.linkedEvidence[0].steps[0], { test_case_id: 'case-0', step_order: 1, action: 'SUBMIT_case-0', expected_result: 'Approval is recorded.' });
  assert.equal(review.linkedEvidence[0].description, 'CASE_DESCRIPTION_0');
  assert.ok(review.linkedEvidence.some(item => item.kind === 'test-suite' && item.id === 'suite'));
  assert.deepEqual(review.linkedEvidence.find(item => item.kind === 'execution').context, { status: 'running', relationship: 'contains_linked_test_case', results_included: false });
  assert.equal(review.linkedEvidence.find(item => item.kind === 'automation-asset').context.execution_verified, false);
  assert.equal(review.evidenceBoundary.totals.test_cases, 10);
  assert.equal(review.evidenceBoundary.included.test_case_step_sets, 6);
  const stepQuery = queries.find(item => /SELECT test_steps\.\*/.test(item.sql));
  assert.match(stepQuery.sql, /app_types\.project_id = \?/);
  assert.deepEqual(stepQuery.args, [...linkedCases.slice(0, 6).map(item => item.id), 'project']);
});

test('Story and Test Case review controls migrate stock guidance and preserve reviewed custom prompts', async () => {
  const catalog = require('../../shared/aiFeatureCatalog.json');
  for (const id of ['ai.requirement.grooming', 'ai.requirement.change_impact', 'ai.test_case.change_impact', 'ai.quality.story_assurance', 'ai.quality.test_case_assurance']) {
    const profile = catalog.find(item => item.id === id);
    const key = id === 'ai.requirement.grooming' ? 'requirementWorkspace.buildGroomingPrompt.26' : 'artifactAssurance.prompt.8';
    const legacy = { ...structuredClone(profile.defaults), prompt: profile.prompt_default_migrations.at(-1),
      instruction_blocks: { ...profile.defaults.instruction_blocks, [key]: profile.instruction_default_migrations[key].at(-1) } };
    for (const [config, expectedPrompt, expectedBlock] of [
      [legacy, profile.defaults.prompt, profile.defaults.instruction_blocks[key]],
      [{ ...legacy, prompt: 'Our reviewed product criteria.', instruction_blocks: { ...legacy.instruction_blocks, [key]: 'Our reviewed output guidance.' } }, 'Our reviewed product criteria.', 'Our reviewed output guidance.']
    ]) {
      const service = load('aiConfiguration.service', { '../src/db': { prepare: () => ({ get: async () => ({ value: { published: { version: 1, config } } }) }) } });
      const resolved = await service.resolve(id);
      assert.equal(resolved.config.prompt, expectedPrompt, id);
      assert.equal(resolved.config.instruction_blocks[key], expectedBlock, id);
      if (id !== 'ai.requirement.grooming') assert.equal(resolved.config.instruction_blocks['artifactAssurance.reviewFocus'], profile.defaults.instruction_blocks['artifactAssurance.reviewFocus']);
    }
  }
});

for (const artifactType of ['story', 'test-case']) for (const purpose of [undefined, 'assurance', 'change-impact']) {
  const expected = purpose === 'assurance' ? `ai.quality.${artifactType === 'story' ? 'story' : 'test_case'}_assurance` : `ai.${artifactType === 'story' ? 'requirement' : 'test_case'}.change_impact`;
  test(`${artifactType} review endpoint service selects ${expected} for ${purpose || 'legacy omitted purpose'}`, async () => {
    const id = artifactType === 'story' ? story.id : caseDraft.id;
    const provider = fixture(JSON.stringify({ summary: 'Review the exact current draft.', dimensions: [{ id: artifactType === 'story' ? 'design-maturity' : 'scenario-coverage', explanation: 'The supplied behavior remains the review boundary.', evidence: [`draft:${artifactType}:${id}`] }], insights: [] }));
    const reviewer = load('artifactAssurance.service', provider.overrides);
    const service = load('qualityAssistance.service', {
      '../db': { prepare: () => ({ get: async () => artifactType === 'story' ? story : caseDraft, all: async () => [] }) },
      './entityScope.service': { requireEntityPermission: async () => ({ projectId: 'project' }) },
      './optionalEvidenceAccess.service': { getOptionalEvidenceAccess: async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, false])) },
      './artifactAssurance.service': reviewer
    });
    const input = { user: { id: 'reviewer' }, reviewPurpose: purpose, proposedChange: { description: 'CURRENT_DRAFT_CONTEXT' } };
    if (artifactType === 'story') await service.previewRequirementImpact({ ...input, requirementId: id });
    else await service.previewTestCaseImpact({ ...input, testCaseId: id });
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].policy.featureKey, expected);
    assert.ok(provider.calls[0].body.messages.every(message => !message.content.includes('HELLOTEST_AI:') || ![...message.content.matchAll(/HELLOTEST_AI:([^:]+):/g)].some(match => match[1] !== expected)));
    assert.match(provider.calls[0].body.messages[1].content, /CURRENT_DRAFT_CONTEXT/);
    assert.equal(provider.calls[0].body.messages[1].content.includes('"ref":"saved:'), purpose !== 'assurance', 'Only impact requires a saved-versus-draft snapshot');
  });
}

test('assurance repair receives the actual validation failure and unambiguous source/category JSON schema', async () => {
  const provider = fixture('unused');
  provider.overrides['../utils/llmHttpClient'].fetchLlmWithRetry = async (url, init, policy) => {
    const body = JSON.parse(init.body); provider.calls.push({ body, policy });
    const finding = { id: 'data-gap', priority: 'medium', kind: provider.calls.length === 1 ? 'data-reliability' : 'artifact_quality',
      title: 'Clarify repeatable setup', explanation: 'The case does not state its initial approval state.', evidence: ['draft:test-case:case'],
      affected_fields: ['steps'], step_refs: ['step:1'], recommendation: 'State the initial invoice approval state before submission.' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...caseReview(), insights: [finding] }) } }] }));
  };
  const result = await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project' });
  assert.equal(provider.calls.length, 2);
  assert.equal(result.response_repaired, true);
  assert.equal(result.assurance_review.insights[0].kind, 'artifact_quality');
  const prompt = require('./helpers/managedInstructions').expandManagedInstructions(provider.calls[1].body.messages[1].content);
  const data = prompt.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(value => value.review_validation_error);
  assert.equal(data.review_validation_error.code, 'AI_ASSURANCE_REVIEW_INVALID');
  assert.match(data.review_validation_error.message, /unsupported finding category/);
  assert.equal(Object.hasOwn(data,'review_output_schema'),false,'The full machine schema is delivered through the transport rather than repeated in user data.');
  const schema=provider.calls[1].policy.outputSchema;
  assert.equal(provider.calls[1].policy.outputSchemaName,'artifact_assurance_review');
  assert.deepEqual(schema,provider.calls[0].policy.outputSchema,'Main and correction requests keep the same native identifiers and contract.');
  const properties = schema.properties.insights.items.properties;
  assert.ok(properties.kind.enum.includes('artifact_quality'));
  assert.ok(!properties.kind.enum.includes('data-reliability'));
  assert.deepEqual(properties.step_refs.items.enum, ['step:1']);
  assert.ok(!properties.evidence.items.enum.includes('step:1'));
  assert.deepEqual(properties.evidence.items.enum,['draft:test-case:case','requirement:story']);
  assert.ok(prompt.includes('data-reliability'), 'The prior meaningful finding remains available for a precise repair');
  assert.match(prompt, /Correct that specific validation problem/);
});

test('linked Test Case wrapper and body share private-data projection and disclose unloaded steps', async () => {
  const provider = fixture(JSON.stringify({ summary: 'Review the supplied Story.', dimensions: [{ id: 'design-maturity', explanation: 'Only loaded case content supports comparison.', evidence: ['draft:story:story'] }], insights: [] }));
  await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', linkedEvidence: [
    { id: 'case-full', kind: 'test-case', title: 'Submit PRIVATE_LINKED_LITERAL', description: 'Reuse @t.account_hint.', steps: [{ action: 'Enter PRIVATE_LINKED_LITERAL', expected_result: 'The request is accepted.' }],
      parameter_values: { account_hint: 'PRIVATE_LINKED_LITERAL' }, test_data_options: { private_parameter_names: ['account_hint'] } },
    { id: 'case-unloaded', kind: 'test-case', title: 'Unloaded steps case', description: 'Its steps were not retrieved.' }
  ] });
  const prompt = provider.calls[0].body.messages[1].content;
  assert.doesNotMatch(prompt, /PRIVATE_LINKED_LITERAL/);
  assert.match(prompt, /private_parameter_values_omitted/);
  assert.match(prompt, /"unavailable_fields":\["steps"\]/);
  assert.doesNotMatch(prompt, /"id":"case-unloaded"[^\n]*?"steps":\[\]/, 'Unretrieved steps cannot imply an authored empty body');
  const data = JSON.parse(prompt.split('\n').at(-1));
  assert.equal(Object.hasOwn(data,'review_output_schema'),false);
  const schema=provider.calls[0].policy.outputSchema;
  assert.ok(schema.properties.dimensions.items.properties.evidence.items.enum.includes('draft:story:story'));
  assert.equal(JSON.stringify(schema).includes('PRIVATE_LINKED_LITERAL'),false);
  const Ajv = require('ajv'); const validate = new Ajv({ strict: false }).compile(schema);
  assert.equal(validate({ summary: 'An empty narrative is not a supported review.', dimensions: [], insights: [], limitations: [] }), false);
  assert.equal(validate({ summary: 'A cited dimension supports the review.', dimensions: [{ id: 'design-maturity', explanation: 'The specified behavior is observable.', evidence: ['draft:story:story'], recommendation: 'Preserve the observable behavior.' }], insights: [], limitations: [] }), true);
});

for (const findings of [['The intended rejection behavior is missing.'], 'The expected result is ambiguous.']) test('meaningful unstructured assurance findings require bounded repair', async () => {
  const provider = fixture(JSON.stringify({ ...caseReview(), insights: findings }));
  await assert.rejects(load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'test-case', savedArtifact: caseDraft,
    linkedEvidence: [{ ...story, kind: 'requirement' }], projectId: 'project' }), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
  assert.equal(provider.calls.length, 2);
});

test('linked legacy Gherkin remains canonical context when description and cached structured steps are unavailable', async () => {
  const provider = fixture(JSON.stringify({ summary: 'Compare canonical linked coverage.', dimensions: [{ id: 'design-maturity', explanation: 'The linked specification supplies reviewable behavior.', evidence: ['test-case:legacy-gherkin'] }], insights: [] }));
  await load('artifactAssurance.service', provider.overrides).reviewArtifact({ artifactType: 'story', savedArtifact: story, projectId: 'project', linkedEvidence: [{ id: 'legacy-gherkin', kind: 'test-case', title: 'Canonical approval', description: null, authoring_mode: 'gherkin', gherkin_document: 'Feature: LINKED_CANONICAL_SPEC\nScenario: Approve\n Given a pending invoice\n When approved\n Then its approver is recorded' }] });
  const prompt = provider.calls[0].body.messages[1].content;
  assert.match(prompt, /LINKED_CANONICAL_SPEC/);
  assert.doesNotMatch(prompt, /metadata_only/);
});
