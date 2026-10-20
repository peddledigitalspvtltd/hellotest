import test from 'node:test';
import assert from 'node:assert/strict';
import { draftReadinessIssues } from '../../frontend/lib/draftReadiness.ts';
import { AI_CONTEXT_PACK_LIMIT, manualContextInstructions, updateManualContextInstructions,
  replaceTemplateContextPack, SMART_CONTEXT_START, SMART_CONTEXT_END } from '../../frontend/lib/aiDesignStudio.ts';

test('acceptance blocks incomplete or over-budget edited drafts', () => {
  const complete = { title: 'Checkout', steps: [{ action: 'Pay', expected_result: 'A receipt appears' }] };
  assert.deepEqual(draftReadinessIssues(complete), []);
  assert.match(draftReadinessIssues({ ...complete, title: '', steps: [] }).join(' '), /title.*1–30/);
  assert.match(draftReadinessIssues({ ...complete, steps: [{ action: 'Pay', expected_result: '' }] }).join(' '), /step 1/);
  assert.match(draftReadinessIssues({ ...complete, steps: Array(31).fill(complete.steps[0]) }).join(' '), /1–30/);
});

test('Gherkin completeness requires actual headings, action and outcome outside doc strings', () => {
  const draft = { title: 'Checkout', authoring_mode: 'gherkin', steps: [],
    gherkin_document: 'Feature: Checkout\nScenario: Purchase\nWhen paying\nThen a receipt appears' };
  assert.deepEqual(draftReadinessIssues(draft), []);
  assert.match(draftReadinessIssues({ ...draft, gherkin_document: 'Feature:\nScenario:\nWhen\nThen' }).join(' '), /named Feature.*named Scenario.*Then outcome/);
  assert.match(draftReadinessIssues({ ...draft, gherkin_document: 'Feature: Checkout\nScenario: Purchase\nWhen paying\n"""\nThen a receipt appears\n"""' }).join(' '), /Then outcome/);
  assert.match(draftReadinessIssues({ ...draft, gherkin_document: draft.gherkin_document + '\n"""\nIncomplete data' }).join(' '), /Close/);
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
 const complete={title:'Invalid sign in',description:'Reject invalid credentials.',priority:2,test_case_type:'functional',steps:[{action:'Sign in',expected_result:'Invalid credentials'}]};
 assert.deepEqual(draftReadinessIssues(complete),[]);
 assert.match(draftReadinessIssues({...complete,description:'',priority:6,test_case_type:''}).join(' '),/description.*priority.*type/);
});
test('shared proposal readiness accepts the existing agent P1–P5 priority representation',()=>{
 const draft={title:'Approval',description:'Review approval',priority:'P2',steps:[{action:'Approve',expected_result:'Approved'}]};assert.deepEqual(draftReadinessIssues(draft),[]);assert.match(draftReadinessIssues({...draft,priority:'urgent'}).join(' '),/priority/);
});
