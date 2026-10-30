import test from 'node:test';
import assert from 'node:assert/strict';
import { draftReadinessIssues, restoreAiPrivateParameterValues } from '../../frontend/lib/draftReadiness.ts';
import { AI_CONTEXT_PACK_LIMIT, manualContextInstructions, updateManualContextInstructions,
  replaceTemplateContextPack, SMART_CONTEXT_START, SMART_CONTEXT_END } from '../../frontend/lib/aiDesignStudio.ts';

test('acceptance blocks incomplete or over-budget edited drafts', () => {
  const complete = { title: 'Checkout', description: 'Complete a purchase and confirm its receipt.', parameter_values: {}, steps: [{ action: 'Pay', expected_result: 'A receipt appears' }] };
  assert.deepEqual(draftReadinessIssues(complete), []);
  assert.match(draftReadinessIssues({ ...complete, title: '', steps: [] }).join(' '), /title.*1–30/);
  assert.match(draftReadinessIssues({ ...complete, steps: [{ action: 'Pay', expected_result: '' }] }).join(' '), /step 1/);
  assert.match(draftReadinessIssues({ ...complete, steps: Array(31).fill(complete.steps[0]) }).join(' '), /1–30/);
});

test('Gherkin completeness requires actual headings, action and outcome outside doc strings', () => {
  const draft = { title: 'Checkout', description: 'Complete a purchase and confirm its receipt.', parameter_values: {}, authoring_mode: 'gherkin', steps: [],
    gherkin_document: 'Feature: Checkout\nScenario: Purchase\nWhen paying\nThen a receipt appears' };
  assert.deepEqual(draftReadinessIssues(draft), []);
  assert.match(draftReadinessIssues({ ...draft, gherkin_document: 'Feature:\nScenario:\nWhen\nThen' }).join(' '), /named Feature.*named Scenario.*Then outcome/);
  assert.match(draftReadinessIssues({ ...draft, gherkin_document: 'Feature: Checkout\nScenario: Purchase\nWhen paying\n"""\nThen a receipt appears\n"""' }).join(' '), /Then outcome/);
  assert.match(draftReadinessIssues({ ...draft, gherkin_document: draft.gherkin_document + '\n"""\nIncomplete data' }).join(' '), /Close/);
  assert.match(draftReadinessIssues({ ...draft, gherkin_document: draft.gherkin_document + '\nScenario: Follow up\nWhen saving again' }).join(' '), /every Scenario/);
});

test('editing manual instructions preserves exact reviewed packs and typing whitespace', () => {
  const evidence = `${SMART_CONTEXT_START}\nSource: story-1\nKeep the audit trail\n${SMART_CONTEXT_END}`;
  const current = replaceTemplateContextPack(`Prior instructions\n\n---\n\n${evidence}`, 'Cover offline CRUD');
  assert.equal(manualContextInstructions(current), 'Prior instructions');
  const next = updateManualContextInstructions(current, 'Exercise checkout ');
  assert.equal(manualContextInstructions(next), 'Exercise checkout ');
  assert.ok(next.includes(evidence));
  assert.match(next, /Cover offline CRUD/);
  assert.equal(updateManualContextInstructions(current, '').includes(evidence), true);
  assert.throws(() => updateManualContextInstructions(current, 'x'.repeat(AI_CONTEXT_PACK_LIMIT)), /context budget/);
});

test('edited AI draft metadata retains the mandatory description, priority and type contract',()=>{
 const complete={title:'Invalid sign in',description:'Reject invalid credentials.',priority:2,test_case_type:'functional',parameter_values:{},steps:[{action:'Sign in',expected_result:'Invalid credentials'}]};
 assert.deepEqual(draftReadinessIssues(complete),[]);
 assert.match(draftReadinessIssues({...complete,description:'',priority:6,test_case_type:''}).join(' '),/description.*priority.*type/);
});
test('shared proposal readiness accepts the existing agent P1–P5 priority representation',()=>{
 const draft={title:'Approval',description:'Review approval',priority:'P2',parameter_values:{},steps:[{action:'Approve',expected_result:'Approved'}]};assert.deepEqual(draftReadinessIssues(draft),[]);assert.match(draftReadinessIssues({...draft,priority:'urgent'}).join(' '),/priority/);
});

test('edited AI drafts require explicit case data, preserve inherited references and reject unresolved aliases', () => {
  const draft={title:'Contact details',description:'Save reusable contact details.',parameter_values:{email:'buyer@example.test'},steps:[{action:'Set email to @t.email',expected_result:'The contact email is @t.email'}]};
  assert.deepEqual(draftReadinessIssues(draft),[]);
  assert.match(draftReadinessIssues({...draft,description:undefined}).join(' '),/description/);
  assert.match(draftReadinessIssues({...draft,parameter_values:undefined}).join(' '),/Test Params/);
  assert.match(draftReadinessIssues({...draft,parameter_values:{}}).join(' '),/t.email/);
  assert.match(draftReadinessIssues({...draft,parameter_values:{email:'@t.contact',contact:'@t.email'}}).join(' '),/circular/);
  assert.match(draftReadinessIssues({...draft,parameter_values:{email:'@t.contact'}}).join(' '),/t.contact/);
  assert.deepEqual(draftReadinessIssues({...draft,parameter_values:{email:'@s.contact_email'}}),[]);
  assert.deepEqual(draftReadinessIssues({...draft,parameter_values:{email:''}}),[], 'Empty-input coverage may supply an explicit empty value');
  assert.deepEqual(draftReadinessIssues({...draft,parameter_values:{'t.email':'buyer@example.test'}}),[], 'Workspace scoped local keys remain compatible');
  assert.match(draftReadinessIssues({...draft,parameter_values:{email:'a@example.test',EMAIL:'b@example.test'}}).join(' '),/only once/);
});

test('native Gherkin tags and comments are not case inputs and an executable When is required', () => {
  const draft={title:'Approval',description:'Approve the supplied invoice.',parameter_values:{},authoring_mode:'gherkin',steps:[],
    gherkin_document:'@t.billing\nFeature: Approval\n# @t.comment_example\nScenario: Approve\nGiven an invoice is submitted\nWhen approving it\nThen it is approved'};
  assert.deepEqual(draftReadinessIssues(draft),[]);
  assert.match(draftReadinessIssues({...draft,gherkin_document:draft.gherkin_document.replace('When approving it\n','')}).join(' '),/When action/);
});

test('native dynamic synthetic data generators do not require fabricated local declarations', () => {
  const draft={title:'Contact details',description:'Save a generated contact address.',parameter_values:{email:'@t.randomString'},steps:[{action:'Set email to @t.email',expected_result:'The contact is saved.'}]};
  assert.deepEqual(draftReadinessIssues(draft),[]);
  for (const name of ['random','string','randomString','randomNumber','yopmail','today','timestamp']) {
    assert.deepEqual(draftReadinessIssues({...draft,parameter_values:{},steps:[{action:`Use @t.${name}`,expected_result:'The supplied input is accepted.'}]}),[]);
  }
});

test('AI improvement preserves current private own values and never creates an override of inherited private data', () => {
  const current = { 't.password': 'PRIVATE_CURRENT_VALUE', 't.email': 'current@example.test' };
  const result = restoreAiPrivateParameterValues({ password: 'invented-password', email: 'buyer@example.test', token: 'invented-token' }, current, ['t.password', 't.token']);
  assert.equal(result.values['t.password'], current['t.password']);
  assert.equal(result.values['t.email'], 'buyer@example.test');
  assert.equal(Object.hasOwn(result.values, 't.token'), false, 'A protected inherited parameter is not replaced by model data');
  assert.deepEqual(result.preservedNames, ['t.password', 't.token']);
  assert.doesNotMatch(JSON.stringify(result.preservedNames), /PRIVATE_CURRENT_VALUE|invented-password|invented-token/);
  assert.equal(restoreAiPrivateParameterValues({}, current, ['t.password']).values['t.password'], current['t.password'], 'Omitting a hidden value cannot erase it');
  assert.deepEqual(current, { 't.password': 'PRIVATE_CURRENT_VALUE', 't.email': 'current@example.test' });
});
